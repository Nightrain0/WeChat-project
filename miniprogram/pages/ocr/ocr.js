Page({
  data: {
    src: '',
    textResult: '',
    isLoading: false,
    
    modeIndex: 0,
    modes: [
      { name: '通用文字', type: 8 },
      { name: 'AI 手写智能纠错', type: 'ai' },
      { name: '身份证(正面)', type: 1 },
      { name: '银行卡', type: 2 },
      { name: '驾驶证', type: 4 },
      { name: '营业执照', type: 7 },
      { name: '行驶证', type: 3 }
    ]
  },

  onModeChange(e) {
    this.setData({ modeIndex: e.detail.value });
    if (this.data.src) {
        wx.showToast({ title: '模式已切换，请重新识别', icon: 'none' });
    }
  },

  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const file = res.tempFiles[0];
        this.setData({ src: file.tempFilePath, textResult: '' });
        this.doOCR(file);
      }
    });
  },

  async doOCR(file) {
    const currentMode = this.data.modes[this.data.modeIndex];
    let filePath = file.tempFilePath;
    
    this.setData({ isLoading: true, textResult: '' });

    // ==========================================
    // 1. AI 模式 (保持云函数调用，逻辑独立)
    // ==========================================
    if (currentMode.type === 'ai') {
      this.callAiOcr(filePath);
      return;
    }

    // ==========================================
    // 2. 微信原生 OCR (Base64 直传 + 暴力压缩)
    // ==========================================
    try {
      // 只要图片大于 100KB，就进行暴力压缩，确保 Base64 绝对不超限
      if (file.size > 100 * 1024) {
        wx.showLoading({ title: '极速压缩...' });
        
        // 1. 获取原图尺寸
        const imgInfo = await wx.getImageInfo({ src: filePath });
        const { width, height } = imgInfo;
        
        // 2. 暴力缩放：长边限制在 800px (OCR 识别完全够用)
        // 之前的 1024px 可能还是偏大，800px 是绝对安全线
        const limit = 800; 
        let targetW = width;
        let targetH = height;
        
        if (width > limit || height > limit) {
          if (width > height) {
            targetW = limit;
            targetH = Math.round(height * (limit / width));
          } else {
            targetH = limit;
            targetW = Math.round(width * (limit / height));
          }
        }

        console.log(`执行暴力压缩: ${width}x${height} -> ${targetW}x${targetH}`);

        // 3. 执行压缩 (质量设为 30，追求极致体积小)
        const compressRes = await wx.compressImage({
          src: filePath,
          quality: 30, 
          compressedWidth: targetW,
          compressedHeight: targetH
        });
        filePath = compressRes.tempFilePath;
      }

      // 压缩完成，直接走 Base64 直传
      this.callWeChatOcrBase64(filePath, currentMode.type);

    } catch (e) {
      console.error('压缩异常:', e);
      // 哪怕压缩失败，也硬着头皮试一下原图，万一能过呢
      this.callWeChatOcrBase64(filePath, currentMode.type);
    }
  },

  // Base64 直传核心逻辑
  callWeChatOcrBase64(filePath, ocrType) {
    wx.showLoading({ title: '识别中...' });
    
    const fs = wx.getFileSystemManager();
    fs.readFile({
      filePath: filePath,
      encoding: 'base64',
      success: (res) => {
        const base64Data = res.data;
        // 打印一下长度，让你放心 (通常会在 100KB 左右)
        console.log('Base64 Length:', base64Data.length);

        wx.serviceMarket.invokeService({
          service: 'wx79ac3de8be320b71',
          api: 'OcrAllInOne',
          data: {
            img_data: base64Data,
            data_type: 2,
            ocr_type: ocrType
          },
        }).then(res => {
          wx.hideLoading();
          const formattedText = this.parseResult(res.data, ocrType);
          if (!formattedText) {
             wx.showToast({ title: '无有效内容', icon: 'none' });
          } else {
             this.setData({ textResult: formattedText });
          }
        }).catch(err => {
          wx.hideLoading();
          console.error('Native OCR Fail:', err);
          let msg = '识别失败';
          if (err.errMsg && err.errMsg.includes('data exceed max size')) {
             // 如果到了这一步还报 max size，那是真的神仙难救了，建议去买彩票
             msg = '图片极其特殊，无法压缩，请使用 AI 模式';
          } else if (err.errMsg && err.errMsg.includes('auth deny')) {
             msg = '请在小程序后台开通 OCR 服务';
          }
          this.showError('提示', msg);
        }).finally(() => {
          this.setData({ isLoading: false });
        });
      },
      fail: (err) => {
        wx.hideLoading();
        this.setData({ isLoading: false });
        this.showError('文件错误', '无法读取图片数据');
      }
    });
  },

  // AI 模式逻辑 (保持不变)
  async callAiOcr(filePath) {
    try {
      wx.showLoading({ title: 'AI 思考中...' });
      const cloudPath = `ocr_temp/ai_${Date.now()}.png`;
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: cloudPath,
        filePath: filePath,
      });
      const res = await wx.cloud.callFunction({
        name: 'aiOcr',
        data: { fileID: uploadRes.fileID }
      });
      wx.hideLoading();
      if (res.result && res.result.success) {
        this.setData({ textResult: res.result.text });
      } else {
        throw new Error(res.result?.error || '云端返回异常');
      }
    } catch (err) {
      wx.hideLoading();
      this.showError('AI 识别失败', err.message);
    } finally {
      this.setData({ isLoading: false });
    }
  },

  showError(title, content) {
    wx.showModal({ title, content, showCancel: false });
  },

  parseResult(data, type) {
    if (!data) return '';
    let result = [];
    try {
      switch (type) {
        case 1: // 身份证
          if (data.idcard_res) {
            const info = data.idcard_res;
            if (info.type === 0) { 
              result.push(`姓名：${info.name.text}`);
              result.push(`性别：${info.gender.text}`);
              result.push(`民族：${info.nationality.text}`);
              result.push(`身份证号：${info.id.text}`);
              result.push(`住址：${info.address.text}`);
            } else { 
              result.push(`有效期：${info.valid_date.text}`);
            }
          }
          break;
        case 2: // 银行卡
          if (data.bankcard_res) result.push(`卡号：${data.bankcard_res.number.text}`);
          break;
        case 4: // 驾驶证
          if (data.driving_license_res) {
            const dl = data.driving_license_res;
            result.push(`证号：${dl.id_num.text}`);
            result.push(`姓名：${dl.name.text}`);
            result.push(`日期：${dl.valid_from.text} - ${dl.valid_to.text}`);
          }
          break;
        case 7: // 营业执照
          if (data.biz_license_res) {
             const bl = data.biz_license_res;
             result.push(`名称：${bl.enterprise_name.text}`);
             result.push(`注册号：${bl.reg_num.text}`);
          }
          break;
        case 3: // 行驶证
            if (data.driving_res) {
                const dr = data.driving_res;
                result.push(`车牌：${dr.plate_num.text}`);
                result.push(`所有人：${dr.owner.text}`);
            }
            break;
        case 8: // 通用文字
        default:
          if (data.ocr_comm_res && data.ocr_comm_res.items) {
            result = data.ocr_comm_res.items.map(item => item.text);
          }
          break;
      }
    } catch (e) { return '解析出错'; }
    if (result.length === 0) return '识别成功，未提取到关键信息';
    return result.join('\n');
  },

  copyText() {
    if(!this.data.textResult) return;
    wx.setClipboardData({ data: this.data.textResult });
  }
});