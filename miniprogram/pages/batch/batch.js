Page({
  data: {
    imageList: [], 
    
    targetSizeKB: '',
    targetWidth: '',
    targetHeight: '',

    isProcessing: false,
    successCount: 0,
    
    cWidth: 300,
    cHeight: 300,
    canvasNode: null,
    canvasCtx: null
  },

  onReady() {
    const query = wx.createSelectorQuery();
    query.select('#batchCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (res[0]) {
          const canvas = res[0].node;
          // 初始化时不设置尺寸，等到处理时再设置
          this.setData({
            canvasNode: canvas,
            canvasCtx: canvas.getContext('2d')
          });
        }
      });
  },

  formatSize(bytes) {
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
    return (bytes / (1024 * 1024)).toFixed(2) + 'MB';
  },

  addImages() {
    wx.chooseMedia({
      count: 9,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const newFiles = res.tempFiles.map(file => ({
          tempFilePath: file.tempFilePath,
          size: file.size,
          orgSizeStr: this.formatSize(file.size),
          status: 'pending', 
          resultPath: '',
          newSizeStr: ''
        }));
        
        this.setData({
          imageList: this.data.imageList.concat(newFiles)
        });
      }
    });
  },

  removeImage(e) {
    const idx = e.currentTarget.dataset.index;
    const list = this.data.imageList;
    list.splice(idx, 1);
    this.setData({ imageList: list });
  },

  onSizeInput(e) { this.setData({ targetSizeKB: e.detail.value }) },
  onWidthInput(e) { this.setData({ targetWidth: e.detail.value }) },
  onHeightInput(e) { this.setData({ targetHeight: e.detail.value }) },

  async startBatch() {
    if (this.data.isProcessing) return;
    
    const list = this.data.imageList;
    let pendingCount = 0;
    
    list.forEach(item => {
      if (item.status !== 'done') {
        item.status = 'pending';
        pendingCount++;
      }
    });
    
    if (pendingCount === 0) {
      wx.showToast({ title: '没有需要处理的图片', icon: 'none' });
      return;
    }

    this.setData({ imageList: list, isProcessing: true, successCount: 0 });
    
    for (let i = 0; i < list.length; i++) {
      if (list[i].status === 'pending') {
        this.setData({ [`imageList[${i}].status`]: 'processing' });
        
        try {
          const result = await this.processOneImage(list[i].tempFilePath);
          this.setData({
            [`imageList[${i}].status`]: 'done',
            [`imageList[${i}].resultPath`]: result.path,
            [`imageList[${i}].newSizeStr`]: this.formatSize(result.size)
          });
        } catch (err) {
          console.error(`图片 ${i} 处理失败`, err);
          this.setData({ [`imageList[${i}].status`]: 'error' });
        }
      }
      
      const success = this.data.imageList.filter(item => item.status === 'done').length;
      this.setData({ successCount: success });
    }

    this.setData({ isProcessing: false });
    wx.showToast({ title: '处理完成', icon: 'success' });
  },

  processOneImage(src) {
    return new Promise((resolve, reject) => {
      if (!this.data.canvasNode) {
        reject('Canvas not ready');
        return;
      }

      wx.getImageInfo({
        src: src,
        success: (info) => {
          let destW = info.width;
          let destH = info.height;

          // 修复：更严谨的数字解析
          const reqW = this.safeParseInt(this.data.targetWidth);
          const reqH = this.safeParseInt(this.data.targetHeight);
          
          // 标记用户是否强制指定了尺寸
          // 如果用户指定了尺寸，我们在压缩时绝对不能缩小，只能降画质
          const isDimensionFixed = (reqW > 0 || reqH > 0);

          // 尺寸计算逻辑
          if (reqW > 0 && reqH > 0) {
            destW = reqW;
            destH = reqH;
          } else if (reqW > 0 && reqH === 0) {
            const ratio = info.height / info.width;
            destW = reqW;
            destH = Math.round(reqW * ratio);
          } else if (reqW === 0 && reqH > 0) {
            const ratio = info.width / info.height;
            destH = reqH;
            destW = Math.round(reqH * ratio);
          }

          let targetBytes = Infinity;
          const reqKB = this.safeParseInt(this.data.targetSizeKB);
          if (reqKB > 0) {
             // 预留 5% 缓冲
             targetBytes = reqKB * 1024 * 0.95;
          }

          // 初始质量设为 0.9，兼顾画质
          this.runCompress(src, destW, destH, 0.9, targetBytes, isDimensionFixed, resolve, reject);
        },
        fail: reject
      });
    });
  },

  safeParseInt(val) {
      const num = parseInt(val);
      return isNaN(num) ? 0 : num;
  },

  runCompress(src, w, h, quality, targetBytes, isDimensionFixed, resolve, reject) {
    const canvas = this.data.canvasNode;
    const ctx = this.data.canvasCtx;

    // 只有尺寸变化时才重设 Canvas 大小 (优化性能)
    if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
    }

    const img = canvas.createImage();
    img.src = src;

    img.onload = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);

      // 如果有目标大小，强制 JPG；否则用 PNG (更清晰)
      // 注意：如果目标是 PNG 且没有大小限制，PNG 是无损的，quality 参数无效
      const useJpg = (targetBytes !== Infinity);
      const fileType = useJpg ? 'jpg' : 'png';

      wx.canvasToTempFilePath({
        canvas: canvas,
        fileType: fileType,
        quality: quality,
        // 【关键修复】显式指定导出宽高，防止模糊和尺寸不匹配
        destWidth: w,
        destHeight: h,
        success: (res) => {
          // 1. 如果不限制大小，直接返回
          if (targetBytes === Infinity) {
             wx.getFileInfo({
                 filePath: res.tempFilePath,
                 success: (info) => resolve({ path: res.tempFilePath, size: info.size })
             });
             return;
          }

          // 2. 检查大小
          wx.getFileInfo({
            filePath: res.tempFilePath,
            success: (fileInfo) => {
              const currentSize = fileInfo.size;
              console.log(`[Batch] 尝试: ${w}x${h}, Q:${quality.toFixed(2)}, Size:${(currentSize/1024).toFixed(1)}KB`);

              if (currentSize <= targetBytes) {
                // 成功达标
                resolve({ path: res.tempFilePath, size: fileInfo.size });
              } else {
                // 未达标，尝试降质
                if (quality > 0.11) {
                  // 智能步进：如果差距过大，步进加大，加快处理速度
                  let step = 0.1;
                  if (currentSize > targetBytes * 2) step = 0.2;
                  
                  const nextQ = Math.max(quality - step, 0.1);
                  this.runCompress(src, w, h, nextQ, targetBytes, isDimensionFixed, resolve, reject);
                } else {
                  // 【关键策略】画质已到底
                  if (isDimensionFixed) {
                      // 如果用户锁定了尺寸，即使不达标也不能改尺寸，返回最低画质结果
                      console.warn('已达最低画质且用户锁定尺寸，强制返回当前结果');
                      resolve({ path: res.tempFilePath, size: fileInfo.size });
                  } else {
                      // 如果用户没锁尺寸（仅限制大小），尝试缩小尺寸
                      const nextW = Math.floor(w * 0.9);
                      const nextH = Math.floor(h * 0.9);
                      if (nextW < 100 || nextH < 100) {
                          resolve({ path: res.tempFilePath, size: fileInfo.size });
                      } else {
                          console.log('画质已到底，尝试缩小尺寸');
                          this.runCompress(src, nextW, nextH, 0.8, targetBytes, isDimensionFixed, resolve, reject);
                      }
                  }
                }
              }
            },
            fail: reject
          });
        },
        fail: reject
      });
    };
    img.onerror = reject;
  },

  async saveAll() {
    const doneList = this.data.imageList.filter(item => item.status === 'done');
    if (doneList.length === 0) return;

    wx.showLoading({ title: '保存中...', mask: true });

    let savedCount = 0;
    for (let item of doneList) {
      try {
        await wx.saveImageToPhotosAlbum({ filePath: item.resultPath });
        savedCount++;
      } catch (err) {
        console.error('保存失败', err);
        if (err.errMsg && err.errMsg.includes('auth')) {
           wx.hideLoading();
           wx.showModal({ content: '保存需要相册权限，请在设置中开启', success: res => res.confirm && wx.openSetting() });
           return;
        }
      }
    }

    wx.hideLoading();
    wx.showToast({ title: `已保存 ${savedCount} 张`, icon: 'success' });
  }
});