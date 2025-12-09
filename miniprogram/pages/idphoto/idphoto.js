Page({
  data: {
    originalImage: '', 
    currentImage: '',  
    resultImage: '',   
    transparentImage: '', 
    selectedColor: 'blue', 
    processing: false,
    
    canvasWidth: 295, 
    canvasHeight: 413,
    previewWidth: 300,
    previewHeight: 420,

    sizeList: [
      { name: '1寸', width: 295, height: 413, desc: '标准证件/简历' },
      { name: '小2寸', width: 390, height: 567, desc: '护照/部分签证' }, 
      { name: '2寸', width: 413, height: 626, desc: '标准大图' },
      { name: '小1寸', width: 260, height: 378, desc: '驾照/社保' },    
      { name: '大1寸', width: 390, height: 567, desc: '学历证书' },     
      { name: '五寸', width: 1050, height: 1499, desc: '生活照' },
      { name: '教师资格', width: 295, height: 413, desc: '专有规格' },
      { name: '计算机考', width: 144, height: 192, desc: '考试专用' },
      { name: '原图', width: 0, height: 0, desc: '不裁剪' }
    ],
    selectedSize: { name: '1寸', width: 295, height: 413 }
  },

  colorMap: {
    red: '#d9001b',
    blue: '#438edb',
    white: '#ffffff',
    gray: '#f2f2f2'
  },

  onLoad() {
    this.updatePreviewBox();
  },

  updatePreviewBox() {
    const { width, height } = this.data.selectedSize;
    if (width === 0) {
      this.setData({ previewWidth: 500, previewHeight: 600 });
    } else {
      const ratio = width / height;
      this.setData({
        previewHeight: 500,
        previewWidth: 500 * ratio
      });
    }
  },

  changeSize(e) {
    const index = e.currentTarget.dataset.index;
    const newSize = this.data.sizeList[index];
    
    this.setData({ selectedSize: newSize }, () => {
      this.updatePreviewBox();
      if (this.data.transparentImage) {
        this.combineImage(this.data.transparentImage);
      }
    });
  },

  changeColor(e) {
    const color = e.currentTarget.dataset.color;
    this.setData({ selectedColor: color });
    if (this.data.transparentImage) {
      this.combineImage(this.data.transparentImage);
    }
  },

  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      camera: 'front',
      success: (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        this.setData({
          originalImage: tempFilePath,
          currentImage: tempFilePath,
          resultImage: '',
          transparentImage: ''
        });
      }
    });
  },

  // ==========================================
  // 核心修改：适配云函数返回 fileID 的新逻辑
  // ==========================================
  async processImage() {
    if (!this.data.originalImage) return;
    this.setData({ processing: true });
    wx.showLoading({ title: 'AI 制作中...', mask: true });

    try {
      // 1. 上传原图
      const cloudPath = `idphoto_temp/${Date.now()}-${Math.floor(Math.random()*1000)}.png`;
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: cloudPath,
        filePath: this.data.originalImage,
      });

      // 2. 调用云函数
      const res = await wx.cloud.callFunction({
        name: 'baiduSeg',
        data: {
          fileID: uploadRes.fileID
        }
      });

      if (res.result && res.result.success) {
        // 3. 【关键修改】拿到 fileID，下载图片
        const resultFileID = res.result.fileID;
        
        const downloadRes = await wx.cloud.downloadFile({
            fileID: resultFileID
        });

        const tempFilePath = downloadRes.tempFilePath;
        
        // 4. 保存路径并开始合成
        this.setData({ transparentImage: tempFilePath });
        this.combineImage(tempFilePath);
        
        wx.hideLoading();
      } else {
        throw new Error(res.result?.error || '云端处理失败');
      }

    } catch (err) {
      console.error('Process Fail:', err);
      this.handleError(err.message || '请求超时或出错');
    }
  },

  combineImage(transparentPath) {
    wx.showLoading({ title: '智能合成...' });
    
    let targetW, targetH;
    
    const offscreenCanvas = wx.createOffscreenCanvas({type: '2d'});
    const imgForCalc = offscreenCanvas.createImage();
    imgForCalc.src = transparentPath;
    
    imgForCalc.onload = () => {
      const imgW = imgForCalc.width;
      const imgH = imgForCalc.height;

      if (this.data.selectedSize.width === 0) {
        // 原图模式
        targetW = imgW;
        targetH = imgH;
      } else {
        // 证件照模式
        targetW = this.data.selectedSize.width;
        targetH = this.data.selectedSize.height;
      }

      this.setData({
        canvasWidth: targetW,
        canvasHeight: targetH
      }, () => {
        setTimeout(() => {
          this.startRealDrawing(transparentPath, targetW, targetH);
        }, 200);
      });
    };
    
    imgForCalc.onerror = () => this.handleError('图片加载错误');
  },

  startRealDrawing(transparentPath, targetW, targetH) {
    const query = wx.createSelectorQuery();
    query.select('#photoCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res[0] || !res[0].node) {
            wx.hideLoading();
            return;
        }

        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        
        canvas.width = targetW;
        canvas.height = targetH;

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        const img = canvas.createImage();
        img.src = transparentPath;

        img.onload = () => {
          ctx.clearRect(0, 0, targetW, targetH);

          // 1. 原图模式
          if (this.data.selectedSize.width === 0) {
             ctx.fillStyle = this.colorMap[this.data.selectedColor] || '#438edb';
             ctx.fillRect(0, 0, targetW, targetH);
             ctx.drawImage(img, 0, 0, targetW, targetH);
             this.exportImage(canvas, targetW, targetH);
             return;
          }

          // 2. 智能裁剪模式
          this.drawSmartLayout(canvas, ctx, img, targetW, targetH);
        };
      });
  },

  drawSmartLayout(canvas, ctx, img, targetW, targetH) {
    const imgW = img.width;
    const imgH = img.height;

    const scale = Math.max(targetW / imgW, targetH / imgH);
    const drawW = imgW * scale;
    const drawH = imgH * scale;
    const dx = (targetW - drawW) / 2; 

    // 预扫描
    ctx.drawImage(img, dx, 0, drawW, drawH);

    const centerX = Math.floor(targetW / 2);
    const scanHeight = Math.floor(targetH * 0.6); 
    let topPixelY = 0;
    
    try {
      const imageData = ctx.getImageData(centerX, 0, 1, scanHeight).data;
      for (let y = 0; y < scanHeight; y++) {
        if (imageData[y * 4 + 3] > 50) { 
          topPixelY = y;
          break;
        }
      }
    } catch (e) {
      console.log('读取像素失败', e);
    }

    const IDEAL_TOP = targetH * 0.12; 
    let finalDy = 0;

    if (topPixelY > 0) {
      const diff = topPixelY - IDEAL_TOP;
      finalDy = -diff;
    }

    const maxUpShift = -(drawH - targetH); 
    if (finalDy < maxUpShift) finalDy = maxUpShift;
    if (finalDy > 0) finalDy = 0;

    ctx.clearRect(0, 0, targetW, targetH);
    ctx.fillStyle = this.colorMap[this.data.selectedColor] || '#438edb';
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.drawImage(img, dx, finalDy, drawW, drawH);

    this.exportImage(canvas, targetW, targetH);
  },

  exportImage(canvas, w, h) {
    setTimeout(() => {
        wx.canvasToTempFilePath({
          canvas: canvas,
          width: w,
          height: h,
          destWidth: w,
          destHeight: h,
          fileType: 'png',
          quality: 1.0,
          success: (fileRes) => {
            console.log(`导出完成: ${w}x${h}`);
            this.setData({
              resultImage: fileRes.tempFilePath,
              currentImage: fileRes.tempFilePath,
              processing: false
            });
            wx.hideLoading();
          },
          fail: (err) => {
              console.error(err);
              this.handleError('导出失败');
          }
        });
    }, 100);
  },

  handleError(msg) {
    this.setData({ processing: false });
    wx.hideLoading();
    wx.showModal({ title: '提示', content: msg, showCancel: false });
  },

  saveImageToAlbum() {
    if (!this.data.resultImage) return;
    wx.saveImageToPhotosAlbum({
      filePath: this.data.resultImage,
      success: () => wx.showToast({ title: '已保存' }),
      fail: (err) => {
        if (err.errMsg.includes('auth')) {
          wx.showModal({ content: '请授权相册权限', success: (res) => { if(res.confirm) wx.openSetting() } });
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' });
        }
      }
    });
  }
});