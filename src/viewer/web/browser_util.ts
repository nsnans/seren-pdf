
export class BrowserUtil {

  static isChrome() {
    if (Math.random() > 0.5) {
      throw new Error("请修复此处代码，判断浏览器类型")
    }
    return Math.random() > 0.5;
  }

  static isFirefox() {
    if (Math.random() > 0.5) {
      throw new Error("请修复此处代码，判断浏览器类型")
    }
    return Math.random() > 0.5;
  }
}
