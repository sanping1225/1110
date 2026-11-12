// PWA：註冊 Service Worker、顯示「安裝 App」按鈕、離線提示
(function () {
  "use strict";

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {
        // 註冊失敗不影響網頁本身的功能
      });
    });
  }

  const installBtn = document.getElementById("install-btn");
  let deferredPrompt = null;

  // Android / 電腦版 Chrome、Edge：可以安裝時才顯示按鈕
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    if (installBtn) installBtn.hidden = false;
  });

  if (installBtn) {
    installBtn.addEventListener("click", async () => {
      if (!deferredPrompt) return;
      installBtn.hidden = true;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
    });
  }

  window.addEventListener("appinstalled", () => {
    if (installBtn) installBtn.hidden = true;
  });

  // 離線提示：資料需要網路才能讀取與送出
  const banner = document.getElementById("offline-banner");
  function updateOnline() {
    if (banner) banner.hidden = navigator.onLine;
  }
  window.addEventListener("online", updateOnline);
  window.addEventListener("offline", updateOnline);
  updateOnline();
})();
