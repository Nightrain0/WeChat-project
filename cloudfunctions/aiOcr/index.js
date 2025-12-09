const cloud = require('wx-server-sdk');
const axios = require('axios');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

exports.main = async (event, context) => {
  const { fileID } = event;
  
  // 从环境变量读取配置 (安全)
  const API_URL = process.env.API_URL;
  const API_KEY = process.env.API_KEY;
  const MODEL = process.env.MODEL;

  try {
    // 1. 下载图片
    const res = await cloud.downloadFile({ fileID });
    const imageBuffer = res.fileContent;
    const base64Image = imageBuffer.toString('base64');

    // 2. 构造 AI 请求 (加入了纠错指令)
    const payload = {
      model: MODEL,
      messages: [
        {
          role: "user",
          content: [
            { 
              type: "text", 
              // 核心修改：这里增加了纠错指令
              text: "请识别这张图片中的手写文字。要求：\n1. 自动纠正识别过程中可能出现的同音字、形近字或手写潦草导致的错误。\n2. 根据上下文逻辑，输出通顺的句子。\n3. 只输出最终修正后的文本内容，不要包含任何解释或Markdown标记。" 
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`
              }
            }
          ]
        }
      ],
      max_tokens: 2048
    };

    // 3. 调用 API
    const aiRes = await axios.post(API_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      }
    });

    // 4. 返回结果
    const content = aiRes.data.choices[0].message.content;
    return {
      success: true,
      text: content
    };

  } catch (err) {
    console.error('AI OCR Error:', err.response ? err.response.data : err);
    return {
      success: false,
      error: err.message || '识别服务不可用'
    };
  }
};