// 最小 service worker: 使应用可安装到主屏幕.
// 离线缓存策略在后续版本加入.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
