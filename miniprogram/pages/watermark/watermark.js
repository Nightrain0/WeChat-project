Page({
  data: {
    src: '',
    text: '仅供办理入职使用', // 默认文案
    fontSize: 24,
    opacity: 0.3,
    color: '#000000',
    density: 3, // 密度 1-5
    
    canvasW: 300,
    canvasH: 300,
    
    isProcessing: false,
    resultPath: ''
  },

  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: (res) => {
        this.setData({ src: res.tempFiles[0].tempFilePath, resultPath: '' });
        this.drawWatermark();
      }
    });
  },

  onInput(e) { this.setData({ text: e.detail.value }); this.drawWatermark(); },
  onFontSize(e) { this.setData({QL: e.detail.value}); this.drawWatermark(); },
  onOpacity(e) { this.setData({ opacity: e.detail.value }); this.drawWatermark(); },
  
  // 切换颜色
  toggleColor() {
    const newColor = this.data.color === '#000000' ? '#ffffff' : '#000000';
    this.setData({ color: newColor });
    this.drawWatermark();
  },

  drawWatermark() {
    if (!this.data.src) return;
    
    const query = wx.createSelectorQuery();
    query.select('#wmCanvas').fields({ node: true, size: true }).exec((res) => {
      if (!res[0]) return;
      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      
      const img = canvas.createImage();
      img.src = this.data.src;
      
      img.onload = () => {
        const w = img.width;
        const h = img.height;
        
        // 设置画布大小
        canvas.width = w;
        canvas.height = h;
        
        // 1. 绘制原图
        // 【修复】绘制原图前，必须先将透明度重置为 1，否则原图也会受之前水印透明度的影响
        ctx.globalAlpha = 1; 
        ctx.drawImage(img, 0, 0, w, h);
        
        // 2. 绘制水印
        ctx.font = `bold ${w * 0.04}px sans-serif`; // 动态字体大小
        ctx.fillStyle = this.data.color;
        // 这里再设置为用户选择的透明度
        ctx.globalAlpha = this.data.opacity;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        
        // 旋转角度 (例如 -30度)
        const angle = -30 * Math.PI / 180;
        
        // 计算平铺间距
        const stepX = w * 0.5; // 水平间距
        const stepY = h * 0.3; // 垂直间距
        
        for (let x = -w; x < w * 2; x += stepX) {
          for (let y = -h; y < h * 2; y += stepY) {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(angle);
            ctx.fillText(this.data.text, 0, 0);
            ctx.restore();
          }
        }
      };
    });
  },

  save() {
    wx.showLoading({ title: '保存中' });
    const query = wx.createSelectorQuery();
    query.select('#wmCanvas').fields({ node: true }).exec((res) => {
      const canvas = res[0].node;
      wx.canvasToTempFilePath({
        canvas: canvas,
        fileType: 'jpg',
        quality: 0.9,
        success: (res) => {
          wx.saveImageToPhotosAlbum({
            filePath: res.tempFilePath,
            success: () => wx.showToast({ title: '已保存' }),
            complete: () => wx.hideLoading()
          });
        }
      });
    });
  }
});