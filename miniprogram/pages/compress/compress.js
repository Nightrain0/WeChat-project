Page({
  data: {
    currentImage: '',
    imageInfo: {}, // { width, height, size, sizeStr }
    
    // 设置
    enableSizeLimit: false,
    targetSizeKB: '',
    
    enableResize: false,
    targetWidth: '',
    targetHeight: '',
    
    // 处理中
    processing: false,
    cWidth: 300, // 画布尺寸
    cHeight: 300,

    // 结果
    resultImage: '',
    resultInfo: {}
  },

  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const file = res.tempFiles[0];
        this.setData({
          currentImage: file.tempFilePath,
          resultImage: '', // 清除上次结果
          imageInfo: {
            width: 0, 
            height: 0,
            size: file.size,
            sizeStr: this.formatSize(file.size)
          }
        });
        
        // 获取图片详细尺寸
        wx.getImageInfo({
          src: file.tempFilePath,
          success: (info) => {
            this.setData({
              'imageInfo.width': info.width,
              'imageInfo.height': info.height
            });
          }
        });
      }
    });
  },

  formatSize(bytes) {
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
    return (bytes / (1024 * 1024)).toFixed(2) + 'MB';
  },

  toggleSizeLimit(e) {
    this.setData({ enableSizeLimit: e.detail.value });
  },
  
  onSizeInput(e) {
    this.setData({ targetSizeKB: e.detail.value });
  },

  toggleResize(e) {
    this.setData({ enableResize: e.detail.value });
  },

  onWidthInput(e) {
    this.setData({ targetWidth: e.detail.value });
  },

  onHeightInput(e) {
    this.setData({ targetHeight: e.detail.value });
  },

  async startCompress() {
    if (!this.data.currentImage) return;
    this.setData({ processing: true });

    try {
      // 1. 计算初始目标尺寸
      let destW = this.data.imageInfo.width;
      let destH = this.data.imageInfo.height;
      
      // 是否强制指定了尺寸
      let isFixedDimension = false;

      if (this.data.enableResize) {
        const inputW = parseInt(this.data.targetWidth);
        const inputH = parseInt(this.data.targetHeight);
        
        if (inputW || inputH) {
            isFixedDimension = true;
        }

        if (inputW && inputH) {
          destW = inputW;
          destH = inputH;
        } else if (inputW && !inputH) {
          const ratio = this.data.imageInfo.height / this.data.imageInfo.width;
          destW = inputW;
          destH = Math.round(inputW * ratio);
        } else if (!inputW && inputH) {
          const ratio = this.data.imageInfo.width / this.data.imageInfo.height;
          destH = inputH;
          destW = Math.round(inputH * ratio);
        }
        // 更新回显
        this.setData({ targetWidth: destW, targetHeight: destH }); 
      }

      // 2. 初始化压缩流程
      this.setData({ cWidth: destW, cHeight: destH }, () => {
         setTimeout(() => {
           this.initCanvasAndCompress(destW, destH, isFixedDimension);
         }, 200);
      });

    } catch (err) {
      console.error(err);
      this.handleError('初始化失败');
    }
  },

  initCanvasAndCompress(w, h, isFixedDimension) {
    const query = wx.createSelectorQuery();
    query.select('#compressCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res[0] || !res[0].node) {
          this.handleError('画布初始化失败');
          return;
        }

        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const img = canvas.createImage();
        img.src = this.data.currentImage;

        img.onload = () => {
          // 3. 计算目标字节数 (预留 5% 缓冲)
          let targetBytes = Infinity;
          if (this.data.enableSizeLimit && this.data.targetSizeKB) {
             targetBytes = parseInt(this.data.targetSizeKB) * 1024 * 0.95; 
          }

          // 开始递归压缩逻辑
          this.runCompressLogic(canvas, ctx, img, w, h, 0.9, targetBytes, isFixedDimension);
        };
        
        img.onerror = () => this.handleError('图片加载失败');
      });
  },

  /**
   * 核心压缩递归函数
   */
  runCompressLogic(canvas, ctx, img, w, h, quality, targetBytes, isFixedDimension) {
    if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
    }
    
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);

    const useJpg = (targetBytes !== Infinity);
    const fileType = useJpg ? 'jpg' : 'png';

    wx.canvasToTempFilePath({
      canvas: canvas,
      fileType: fileType,
      quality: quality, 
      // 【核心修复】显式指定输出宽高，保证清晰度和尺寸精准
      destWidth: w,
      destHeight: h,
      success: (res) => {
        if (targetBytes === Infinity) {
             this.finishCompress(res.tempFilePath, w, h);
             return;
        }

        wx.getFileInfo({
          filePath: res.tempFilePath,
          success: (fileInfo) => {
            const currentSize = fileInfo.size;
            console.log(`[Compress] ${w}x${h}, Q:${quality.toFixed(1)}, Size:${this.formatSize(currentSize)}`);

            if (currentSize <= targetBytes) {
              // 成功
              this.finishCompress(res.tempFilePath, w, h, currentSize);
            } else {
              // 依然太大
              if (quality > 0.11) {
                // A计划：降画质
                // 动态步进，如果差距很大（比如2倍），步进快一点
                let step = 0.1;
                if (currentSize > targetBytes * 2) step = 0.2;
                const nextQ = Math.max(quality - step, 0.1);
                
                this.runCompressLogic(canvas, ctx, img, w, h, nextQ, targetBytes, isFixedDimension);
              } else {
                // B计划：画质到底了
                if (isFixedDimension) {
                    // 如果用户指定了分辨率，我们不能缩小尺寸，只能接受这个结果
                    console.warn('已达最低画质，因用户锁定尺寸，无法继续压缩，返回结果');
                    // 这里可以加一个 Toast 提示用户
                    wx.showToast({ title: '已达极限压缩，无法更小', icon: 'none' });
                    this.finishCompress(res.tempFilePath, w, h, currentSize);
                } else {
                    // 如果用户没指定分辨率（只关心大小），则允许缩小尺寸
                    const nextW = Math.floor(w * 0.9);
                    const nextH = Math.floor(h * 0.9);
                    
                    if (nextW < 50 || nextH < 50) {
                       this.finishCompress(res.tempFilePath, w, h, currentSize);
                       return;
                    }
                    console.log(`执行尺寸缩放 -> ${nextW}x${nextH}`);
                    // 尺寸缩小后，画质可以回调一些，避免太糊
                    this.runCompressLogic(canvas, ctx, img, nextW, nextH, 0.8, targetBytes, isFixedDimension);
                }
              }
            }
          },
          fail: () => this.handleError('获取文件信息失败')
        });
      },
      fail: () => this.handleError('导出图片失败')
    });
  },

  finishCompress(path, w, h, size) {
    if (!size) {
        wx.getFileInfo({
            filePath: path,
            success: (res) => {
                this.showResult(path, res.size, w, h);
            }
        });
    } else {
        this.showResult(path, size, w, h);
    }
  },

  showResult(path, size, w, h) {
    this.setData({
      resultImage: path,
      processing: false,
      resultInfo: {
        width: w,
        height: h,
        size: size,
        sizeStr: this.formatSize(size)
      }
    });
  },

  closeResult() {
    this.setData({ resultImage: '' });
  },

  previewResult() {
    if(this.data.resultImage) {
      wx.previewImage({ urls: [this.data.resultImage] });
    }
  },

  saveImage() {
    if (!this.data.resultImage) return;
    wx.saveImageToPhotosAlbum({
      filePath: this.data.resultImage,
      success: () => wx.showToast({ title: '已保存' }),
      fail: (err) => {
        if(err.errMsg.includes('auth')) {
          wx.showModal({ content: '请授权相册权限', success: (res) => { if(res.confirm) wx.openSetting() }});
        }
      }
    });
  },

  handleError(msg) {
    this.setData({ processing: false });
    wx.showToast({ title: msg, icon: 'none' });
  }
});