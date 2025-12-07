// ⬇️⬇️⬇️ 请在这里填入你从百度AI平台获取的密钥 ⬇️⬇️⬇️
const BAIDU_AK = 'e892AkrmOduHty57cPQE76dw'; 
const BAIDU_SK = '53bINm1ddq90QlgUt73YPWw7Cjp5PQvq'; 

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

    // 尺寸列表 (300dpi 标准)
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
        // 切换尺寸时，直接调用合成，具体的延时逻辑在 combineImage 内部处理
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

  processImage() {
    if (!this.data.originalImage) return;
    this.setData({ processing: true });
    wx.showLoading({ title: 'AI 制作中...', mask: true });

    const fs = wx.getFileSystemManager();
    fs.readFile({
      filePath: this.data.originalImage,
      encoding: 'base64',
      success: (res) => {
        this.getBaiduToken(res.data);
      },
      fail: (err) => this.handleError('读取图片失败')
    });
  },

  getBaiduToken(base64Img) {
    wx.request({
      url: `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${BAIDU_AK}&client_secret=${BAIDU_SK}`,
      method: 'POST',
      success: (res) => {
        if (res.data.access_token) {
          this.callBaiduSeg(res.data.access_token, base64Img);
        } else {
          this.handleError('Token获取失败，请检查API Key');
        }
      },
      fail: () => this.handleError('网络错误')
    });
  },

  callBaiduSeg(token, base64Img) {
    wx.request({
      url: `https://aip.baidubce.com/rest/2.0/image-classify/v1/body_seg?access_token=${token}`,
      method: 'POST',
      header: { 'content-type': 'application/x-www-form-urlencoded' },
      data: { image: base64Img, type: 'foreground' },
      success: (res) => {
        if (res.data.foreground) {
          this.saveBase64ToLocal(res.data.foreground);
        } else {
          this.handleError('抠图失败: ' + (res.data.error_msg || '未知'));
        }
      },
      fail: () => this.handleError('请求失败')
    });
  },

  saveBase64ToLocal(base64Str) {
    const fs = wx.getFileSystemManager();
    const tempFilePath = `${wx.env.USER_DATA_PATH}/baidu_result_${Date.now()}.png`;
    fs.writeFile({
      filePath: tempFilePath,
      data: wx.base64ToArrayBuffer(base64Str),
      encoding: 'binary',
      success: () => {
        this.setData({ transparentImage: tempFilePath });
        this.combineImage(tempFilePath);
      },
      fail: (err) => this.handleError('文件保存失败')
    });
  },

  // --- 关键修复：重构合成流程 ---
  combineImage(transparentPath) {
    wx.showLoading({ title: '智能合成...' });
    
    // 1. 第一步：先计算目标尺寸
    let targetW, targetH;
    
    // 必须创建一个 Image 对象来获取原图尺寸，即使是计算也要用到
    const offscreenCanvas = wx.createOffscreenCanvas({type: '2d'});
    const imgForCalc = offscreenCanvas.createImage();
    imgForCalc.src = transparentPath;
    
    imgForCalc.onload = () => {
      const imgW = imgForCalc.width;
      const imgH = imgForCalc.height;
      
      if (this.data.selectedSize.width === 0) {
        targetW = imgW;
        targetH = imgH;
      } else {
        targetW = this.data.selectedSize.width;
        targetH = this.data.selectedSize.height;
      }

      // 2. 第二步：先改变 WXML 里的 Canvas 样式尺寸
      this.setData({
        canvasWidth: targetW,
        canvasHeight: targetH
      }, () => {
        // 3. 第三步：【关键延时】等待 200ms，确保视图层 Canvas 已经真的变大了
        // 之前的 nextTick 太快了，手机反应不过来
        setTimeout(() => {
          this.startRealDrawing(transparentPath, targetW, targetH);
        }, 200);
      });
    };
    
    imgForCalc.onerror = () => this.handleError('图片加载错误');
  },

  // 真正的绘图逻辑，分离出来
  startRealDrawing(transparentPath, targetW, targetH) {
    const query = wx.createSelectorQuery();
    query.select('#photoCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res[0] || !res[0].node) return;

        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        
        // 显式设置 Canvas 内部像素大小 (这一步至关重要，必须与 CSS 尺寸匹配)
        canvas.width = targetW;
        canvas.height = targetH;

        const img = canvas.createImage();
        img.src = transparentPath;

        img.onload = () => {
          // 清空画布
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

    // 1. 填满画布 (Cover)
    const scale = Math.max(targetW / imgW, targetH / imgH);
    const drawW = imgW * scale;
    const drawH = imgH * scale;
    const dx = (targetW - drawW) / 2; // 水平居中

    // 2. 预扫描头顶 (基于原图比例简单估算，或者直接绘制一次扫描)
    // 为了性能和稳定性，我们先在画布上画一次，用来检测
    ctx.drawImage(img, dx, 0, drawW, drawH);

    // 扫描中间竖线
    const centerX = Math.floor(targetW / 2);
    // 只扫描上半部分，提高效率
    const scanHeight = Math.floor(targetH * 0.6); 
    let topPixelY = 0;
    
    try {
      const imageData = ctx.getImageData(centerX, 0, 1, scanHeight).data;
      for (let y = 0; y < scanHeight; y++) {
        if (imageData[y * 4 + 3] > 50) { // Alpha > 50
          topPixelY = y;
          break;
        }
      }
    } catch (e) {
      console.log('读取像素失败，使用默认顶部对齐', e);
    }

    console.log('检测到头顶位置 Y:', topPixelY);

    // 3. 计算偏移
    // 目标：头顶在画布 10% - 12% 处
    const IDEAL_TOP = targetH * 0.12; 
    let finalDy = 0;

    if (topPixelY > 0) {
      // 如果检测到了头顶，计算需要往上移多少
      const diff = topPixelY - IDEAL_TOP;
      // 如果 diff > 0，说明头太靠下，需要上移 (dy 为负)
      // 如果 diff < 0，说明头太靠上 (切头了)，需要下移 (dy 为正)，但最大不能超过 0
      finalDy = -diff;
    }

    // 4. 边界限制 (防止底部穿帮)
    // 图片总高 drawH，画布高 targetH
    // 最多能往上提 maxUpShift (负数)
    const maxUpShift = -(drawH - targetH); 
    
    // 如果算出来的 dy 比 maxUpShift 还小（提太多了），就卡住
    if (finalDy < maxUpShift) finalDy = maxUpShift;
    
    // 如果算出来的 dy 大于 0（头顶留白太多，想往下移），强制贴顶
    // 证件照宁可切一点头顶，也不能留大白边
    if (finalDy > 0) finalDy = 0;

    // 5. 正式绘制
    // 先清空，填充背景色
    ctx.clearRect(0, 0, targetW, targetH);
    ctx.fillStyle = this.colorMap[this.data.selectedColor] || '#438edb';
    ctx.fillRect(0, 0, targetW, targetH);
    
    // 绘制调整后的人像
    ctx.drawImage(img, dx, finalDy, drawW, drawH);

    this.exportImage(canvas, targetW, targetH);
  },

  exportImage(canvas, w, h) {
    // 再次延迟，等待绘制缓冲区刷新
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