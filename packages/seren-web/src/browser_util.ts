
export class BrowserUtil {

  static isChrome() {
    return /Chrome/.test(navigator.userAgent) && !/Edg/.test(navigator.userAgent) && window.chrome;
  }

  static isFirefox() {
    return /Firefox/.test(navigator.userAgent) && 'MozAppearance' in document.documentElement.style;
  }
}
