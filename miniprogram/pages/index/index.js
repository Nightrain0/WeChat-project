Page({
  // 页面导航
  navTo(e) {
    const page = e.currentTarget.dataset.page;
    let url = '';
    
    switch (page) {
      case 'idphoto':
        url = '/pages/idphoto/idphoto';
        break;
      case 'compress':
        url = '/pages/compress/compress';
        break;
      case 'batch':
        url = '/pages/batch/batch';
        break;
      case 'watermark':
        url = '/pages/watermark/watermark';
        break;
      case 'stitch':
        url = '/pages/stitch/stitch';
        break;
      case 'ocr':
        url = '/pages/ocr/ocr';
        break;
    }

    if (url) {
      wx.navigateTo({ url });
    }
  },

  // 新增：清除缓存与强制更新逻辑
  handleClearCache() {
    wx.showModal({
      title: '清理与更新',
      content: '将清除本地缓存并重新加载小程序，确定吗？',
      success: (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '正在清理...', mask: true });
          
          // 1. 清除本地数据缓存 (Storage)
          try {
            wx.clearStorageSync();
          } catch(e) { console.error('Clear storage failed', e) }

          // 2. 尝试获取更新管理器，强制检查是否有新版本
          if (wx.canIUse('getUpdateManager')) {
            const updateManager = wx.getUpdateManager();
            
            updateManager.onCheckForUpdate(function (res) {
              console.log('Manually checked update:', res.hasUpdate);
            });

            updateManager.onUpdateReady(function () {
              wx.hideLoading();
              updateManager.applyUpdate(); // 强制重启应用新版本
            });

            updateManager.onUpdateFailed(function () {
              // 无论是没更新还是下载失败，都执行重启页面的兜底逻辑
              wx.hideLoading();
              wx.reLaunch({ url: '/pages/index/index' });
              wx.showToast({ title: '已刷新', icon: 'success' });
            });
          }
          
          // 兜底：如果API调用太快没有触发回调，1.5秒后强制重启当前页
          setTimeout(() => {
            wx.hideLoading();
            wx.reLaunch({ url: '/pages/index/index' });
          }, 1500);
        }
      }
    });
  }
});