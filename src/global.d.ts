
// 扩展 window 对象，添加 一些全局 属性
declare global {
  interface Window {
    URL: typeof URL;
  }
}