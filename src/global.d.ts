import { Event } from "./scripting_api/event";

// 扩展 window 对象，添加 一些全局 属性
export declare global {

  interface Window {
    chrome?: boolean;
  }

  interface EventTarget {
    name: string;
  }

}
