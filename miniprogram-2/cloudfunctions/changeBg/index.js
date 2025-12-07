const cloud = require('wx-server-sdk');
const Jimp = require('jimp');
const axios = require('axios'); // 引入 axios 用于请求 API

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

// 你的 Remove.bg API Key
const API_KEY = 'P5QEtWoESb1JJ87YXZzHPPCj';

// 颜色映射配置
const COLOR_MAP = {
  red: '#d9001b',   // 证件照红
  blue: '#438edb',  // 证件照蓝
  white: '#ffffff', // 白底
  gray: '#f2f2f2'   // 灰底
};

exports.main = async (event, context) => {
  const { fileID, colorType = 'blue' } = event;
  
  console.log('开始处理，目标颜色:', colorType);

  try {
    // 1. 获取图片临时链接 (Remove.bg 需要公网可访问的 URL)
    const res = await cloud.getTempFileURL({ fileList: [fileID] });
    const fileUrl = res.fileList[0].tempFileURL;

    if (!fileUrl) {
      throw new Error('无法获取图片链接');
    }

    console.log('图片链接获取成功，正在请求 AI 抠图接口...');

    // 2. 调用 Remove.bg API 进行抠图
    // 注意：Remove.bg 免费版 API 每月只有 50 张额度，超过会返回 402 错误
    let removeBgResponse;
    try {
      removeBgResponse = await axios.post(
        'https://api.remove.bg/v1.0/removebg',
        {
          image_url: fileUrl,
          size: 'auto',      // 自动大小
          type: 'person',    // 指定处理人像
          format: 'png'      // 强制返回 png 格式
        },
        {
          headers: {
            'X-Api-Key': API_KEY,
            'Content-Type': 'application/json',
            'Accept': 'application/json' // 明确告诉服务器我们发送的是 JSON
          },
          responseType: 'arraybuffer' // 关键：必须告诉 axios 我们要二进制数据
        }
      );
    } catch (apiError) {
        console.error('API调用失败详细信息:', apiError.response ? apiError.response.data.toString() : apiError.message);
        throw new Error('抠图接口调用失败，请检查额度或网络');
    }

    console.log('AI 抠图完成，正在合成背景...');

    // 3. 读取抠图后的透明图片数据 (Buffer)
    const transparentImage = await Jimp.read(removeBgResponse.data);

    // 4. 创建纯色背景
    const width = transparentImage.bitmap.width;
    const height = transparentImage.bitmap.height;
    const bgColor = COLOR_MAP[colorType] || COLOR_MAP.blue;
    
    // 创建一个新的背景图
    const bgImage = new Jimp(width, height, bgColor);

    // 5. 合成图片 (将透明人像覆盖在背景图上)
    bgImage.composite(transparentImage, 0, 0, {
      mode: Jimp.BLEND_SOURCE_OVER,
      opacitySource: 1,
      opacityDest: 1
    });

    // 6. 导出图片 Buffer
    const buffer = await bgImage.getBufferAsync(Jimp.MIME_PNG);

    // 7. 上传处理后的图片回云存储
    const uploadResult = await cloud.uploadFile({
      cloudPath: `processed/${Date.now()}_${Math.floor(Math.random()*1000)}.png`,
      fileContent: buffer,
    });

    return {
      success: true,
      data: uploadResult.fileID,
      message: '背景更换成功'
    };

  } catch (err) {
    console.error('云函数处理错误:', err);
    return {
      success: false,
      error: err.message
    };
  }
};