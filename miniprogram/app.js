App({
  onLaunch: function () {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      wx.cloud.init({
        // 您的环境 ID
        env: 'cloudbase-4gytpikl1881ec61', 
        traceUser: true,
      });
    }

    this.globalData = {};

    // 启动时自动检查更新
    this.autoUpdate();
  },

  // 自动更新检测方法
  autoUpdate: function() {
    if (wx.canIUse('getUpdateManager')) {
      const updateManager = wx.getUpdateManager();

      updateManager.onCheckForUpdate(function (res) {
        // 请求完新版本信息的回调
        if (res.hasUpdate) {
          console.log('检测到新版本');
        }
      });

      updateManager.onUpdateReady(function () {
        wx.showModal({
          title: '更新提示',
          content: '新版本已经准备好，是否重启应用？',
          showCancel: false, // 强制更新
          success: function (res) {
            if (res.confirm) {
              // 新的版本已经下载好，调用 applyUpdate 应用新版本并重启
              updateManager.applyUpdate();
            }
          }
        });
      });

      updateManager.onUpdateFailed(function () {
        // 新版本下载失败
        console.error('新版本下载失败，请检查网络');
      });
    }
  }
});