const cloud = require('wx-server-sdk');
const axios = require('axios');
const qs = require('qs');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

exports.main = async (event, context) => {
  const { fileID } = event;
  const AK = process.env.BAIDU_AK;
  const SK = process.env.BAIDU_SK;

  try {
    // 1. 获取 Access Token
    const tokenUrl = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${AK}&client_secret=${SK}`;
    const tokenRes = await axios.post(tokenUrl);
    
    if (!tokenRes.data.access_token) {
      throw new Error('获取百度 Token 失败');
    }
    const accessToken = tokenRes.data.access_token;

    // 2. 从云存储下载图片
    const res = await cloud.downloadFile({ fileID });
    const imageBase64 = res.fileContent.toString('base64');

    // 3. 调用人像分割 API
    const segUrl = `https://aip.baidubce.com/rest/2.0/image-classify/v1/body_seg?access_token=${accessToken}`;
    
    const result = await axios.post(segUrl, qs.stringify({
      image: imageBase64,
      type: 'foreground' // 直接请求前景图
    }), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    if (result.data.error_msg) {
      throw new Error('百度 API 错误: ' + result.data.error_msg);
    }

    // -----------------------------------------------------------
    // 修改开始：解决 6MB 限制问题
    // -----------------------------------------------------------

    // 4. 将 Base64 转换为 Buffer
    const buffer = Buffer.from(result.data.foreground, 'base64');

    // 5. 上传处理后的图片到云存储 (文件名加随机数防冲突)
    const uploadRes = await cloud.uploadFile({
      cloudPath: `baidu_seg_result/${Date.now()}_${Math.floor(Math.random() * 1000)}.png`,
      fileContent: buffer,
    });

    // 6. 返回 fileID 而不是 Base64 内容
    return {
      success: true,
      fileID: uploadRes.fileID
    };

  } catch (err) {
    console.error('Baidu Seg Error:', err);
    return {
      success: false,
      error: err.message || '云端处理异常'
    };
  }
};