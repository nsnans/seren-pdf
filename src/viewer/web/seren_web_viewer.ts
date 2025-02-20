import { WebPDFViewer } from "./viewer";
import { WebPDFViewerContext } from "./viewer_context";
import { WebPDFViewerGeneralOptions, WebPDFViewerOptions } from "./viewer_options";

export class WebSerenViewer {

  static init(containerId: string, options: Partial<WebPDFViewerOptions> = {}): WebPDFViewer {
    if (containerId === null || containerId === undefined) {
      throw new Error('请指定一个div元素作为container！')
    }
    const viewerOptions = new WebPDFViewerGeneralOptions(options)
    const context = new WebPDFViewerContext(viewerOptions);
    const container = document.getElementById(containerId);
    if (container === null || !(container instanceof HTMLDivElement)) {
      throw new Error(`无法初始化PDF阅读器，因为无法找到ID名为${containerId}的元素，或者该元素不是DIV类型的元素。`);
    }
    return new WebPDFViewer(context, container);
  }
}