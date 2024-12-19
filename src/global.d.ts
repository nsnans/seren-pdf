
// 扩展 window 对象，添加 一些全局 属性
export declare global {

  interface Window {
    console: Console;
    URL: typeof URL;
    CustomEvent: typeof CustomEvent;
  }

}
