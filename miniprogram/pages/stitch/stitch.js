Page({
  data: {
    images: [],
    isProcessing: false,
    
    // 布局设置
    mode: 'vertical', 
    gap: 0,           
    padding: 0,       
    radius: 0,        
    bgColor: '#ffffff',
    
    // 宫格专属设置
    gridCols: 3, 
    gridRatio: 1, // 格子宽高比
    
    colors: ['#ffffff', '#000000', '#f7f8fa', '#ffcccc', '#e6f9f0', '#ebf5ff']
  },

  addImages() {
    wx.chooseMedia({
      mediaType: ['image'],
      count: 9,
      success: (res) => {
        const newImgs = res.tempFiles.map(f => ({ path: f.tempFilePath }));
        this.setData({ images: this.data.images.concat(newImgs) });
      }
    });
  },

  remove(e) {
    const idx = e.currentTarget.dataset.index;
    const list = this.data.images;
    list.splice(idx, 1);
    this.setData({ images: list });
  },

  setMode(e) { this.setData({ mode: e.currentTarget.dataset.mode }); },
  setGap(e) { this.setData({ gap: e.detail.value }); },
  setPadding(e) { this.setData({ padding: e.detail.value }); },
  setRadius(e) { this.setData({ radius: e.detail.value }); },
  setColor(e) { this.setData({ bgColor: e.currentTarget.dataset.color }); },
  setGridCols(e) { this.setData({ gridCols: e.detail.value }); },
  setGridRatio(e) { this.setData({ gridRatio: e.detail.value }); },

  async stitch() {
    if (this.data.images.length === 0) return;
    this.setData({ isProcessing: true });
    wx.showLoading({ title: '高清拼接中...' });

    try {
      const infoPromises = this.data.images.map(img => {
        return new Promise((resolve) => {
          wx.getImageInfo({ 
            src: img.path, 
            success: resolve, 
            fail: () => resolve(null) 
          });
        });
      });

      const rawInfos = await Promise.all(infoPromises);
      const infos = rawInfos.filter(i => i); 

      if (infos.length === 0) throw new Error('无有效图片');

      const query = wx.createSelectorQuery();
      query.select('#stitchCanvas').fields({ node: true, size: true }).exec(async (res) => {
        if (!res[0]) return;
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');

        const layout = this.calculateLayout(infos, this.data.mode);
        
        // 尺寸保护
        const MAX_SIZE = 4096;
        let scaleFactor = 1;
        if (layout.totalWidth > MAX_SIZE || layout.totalHeight > MAX_SIZE) {
            scaleFactor = Math.min(MAX_SIZE / layout.totalWidth, MAX_SIZE / layout.totalHeight);
            layout.totalWidth *= scaleFactor;
            layout.totalHeight *= scaleFactor;
            layout.items.forEach(item => {
                item.x *= scaleFactor;
                item.y *= scaleFactor;
                item.w *= scaleFactor;
                item.h *= scaleFactor;
            });
        }

        canvas.width = layout.totalWidth;
        canvas.height = layout.totalHeight;

        ctx.fillStyle = this.data.bgColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        for (let i = 0; i < infos.length; i++) {
          const item = layout.items[i];
          const img = canvas.createImage();
          await new Promise((resolve) => {
            img.onload = resolve;
            img.src = infos[i].path;
          });

          ctx.save();
          
          // 圆角裁剪
          const r = (this.data.radius > 0) ? (this.data.radius * 3 * scaleFactor) : 0;
          if (r > 0) {
             this.roundRect(ctx, item.x, item.y, item.w, item.h, r);
             ctx.clip();
          }

          if (this.data.mode === 'grid') {
             // 默认使用 AspectFit (完整显示)，通过调节格子比例来适配
             this.drawAspectFit(ctx, img, item.x, item.y, item.w, item.h, infos[i].width, infos[i].height);
          } else {
             ctx.drawImage(img, item.x, item.y, item.w, item.h);
          }
          
          ctx.restore();
        }

        wx.canvasToTempFilePath({
          canvas: canvas,
          fileType: 'jpg',
          quality: 0.95, 
          destWidth: canvas.width,
          destHeight: canvas.height,
          success: (res) => {
            wx.hideLoading();
            this.setData({ isProcessing: false });
            wx.previewImage({ urls: [res.tempFilePath] });
            wx.saveImageToPhotosAlbum({ filePath: res.tempFilePath });
          },
          fail: (err) => {
             wx.hideLoading();
             this.setData({ isProcessing: false });
             wx.showToast({ title: '导出失败', icon: 'none' });
          }
        });
      });

    } catch (err) {
      wx.hideLoading();
      this.setData({ isProcessing: false });
      wx.showToast({ title: '处理出错', icon: 'none' });
    }
  },

  calculateLayout(infos, mode) {
    const baseSize = 2000; 
    const multiplier = 4; 
    const gap = this.data.gap * multiplier; 
    const pad = this.data.padding * multiplier;
    
    const items = [];
    let totalWidth = 0;
    let totalHeight = 0;

    if (mode === 'vertical') {
      totalWidth = baseSize + pad * 2;
      let currentY = pad;
      infos.forEach(info => {
        const scale = baseSize / info.width;
        const h = info.height * scale;
        items.push({ x: pad, y: currentY, w: baseSize, h: h });
        currentY += h + gap;
      });
      totalHeight = Math.max(currentY - gap + pad, pad * 2);

    } else if (mode === 'horizontal') {
      const baseH = 1500; 
      totalHeight = baseH + pad * 2;
      let currentX = pad;
      infos.forEach(info => {
        const scale = baseH / info.height;
        const w = info.width * scale;
        items.push({ x: currentX, y: pad, w: w, h: baseH });
        currentX += w + gap;
      });
      totalWidth = Math.max(currentX - gap + pad, pad * 2);

    } else {
      // Grid Mode
      const cols = this.data.gridCols;
      const containerW = 2400; 
      const cellSizeW = (containerW - (pad * 2) - (gap * (cols - 1))) / cols;
      const cellSizeH = cellSizeW / this.data.gridRatio;
      
      let maxRow = 0;

      infos.forEach((info, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);
        maxRow = row;
        
        const x = pad + col * (cellSizeW + gap);
        const y = pad + row * (cellSizeH + gap);
        
        items.push({ x, y, w: cellSizeW, h: cellSizeH });
      });

      totalWidth = containerW;
      totalHeight = pad + (maxRow + 1) * (cellSizeH + gap) - gap + pad;
      if(infos.length === 0) totalHeight = pad * 2;
    }

    return { totalWidth, totalHeight, items };
  },

  drawAspectFit(ctx, img, x, y, w, h, imgW, imgH) {
    const scale = Math.min(w / imgW, h / imgH);
    const drawW = imgW * scale;
    const drawH = imgH * scale;
    const dx = x + (w - drawW) / 2;
    const dy = y + (h - drawH) / 2;
    ctx.drawImage(img, dx, dy, drawW, drawH);
  },

  roundRect(ctx, x, y, w, h, r) {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
});