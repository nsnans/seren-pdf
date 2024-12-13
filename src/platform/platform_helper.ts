

/**
 * 在原来的pdfjs中，pdfjs根据打包效果会生成多种不同的包
 * 不同的包适合放在不同的平台下，有的包适合放在web下，有的包适合放在移动端
 * 有的适合添加一些火狐浏览器的特殊逻辑，有的适合在测试环境下跑，因此有着大量的判断
 * 这些判断在未来可能不需要了，因此直接将其移除或者替换掉了
 */
class PlatformHelper {
  
  static isChrome() {
    return true;
  }

  static hasDefined() {
    return true;
  }

  // 对应原来的 typeof PDFJSDev !== "undefined" && PDFJSDev.test("MOZCENTRAL")
  static isMozCental() {
    return false;
  }

  // 对应原来的 typeof PDFJSDev === "undefined" || PDFJSDev.test("GENERIC")
  static isGeneric() {
    return true;
  }

  static isTesting() {
    return false;
  }

  static testLib() {
    return false;
  }

  static testImageDecoders() {
    return false;
  }

  static bundleVersion() {
    return "unkown";
  }

  static bundleBuild() {
    return "unknown";
  }
}

export { PlatformHelper };