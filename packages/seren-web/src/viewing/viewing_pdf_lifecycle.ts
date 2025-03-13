import { ViewingPDFLifecycleCallback } from "../viewer";
import { ViewingPDFContext } from "./viewing_pdf_context";

class ViewingPDFCallbacker {

  protected afterPageDivInit: ((pageNum: number, divWrapper: HTMLDivElement) => void) | null;

  // 早期回调先不考虑数组的问题，这个问题后面需要解决，解决起来也很容易
  // 也不要使用Map来存，因为Map会丢类型
  constructor(callbacks: Partial<ViewingPDFLifecycleCallback>) {
    this.afterPageDivInit = callbacks.afterPageDivInit ?? null;
  }

  runAfterPageDivInit(pageNum: number, divWrapper: HTMLDivElement) {
    this.afterPageDivInit?.(pageNum, divWrapper);
  }
}

export class ViewingPDFLifecycle {

  protected viewingContext: ViewingPDFContext;

  protected viewingCallbacker: ViewingPDFCallbacker;

  constructor(callbacks: Partial<ViewingPDFLifecycleCallback>) {
    this.viewingContext = new ViewingPDFContext();
    this.viewingCallbacker = new ViewingPDFCallbacker(callbacks);
  }

  getViewingContext(): ViewingPDFContext {
    return this.viewingContext;
  }

  afterPageDivInit(pageNum: number, divWrapper: HTMLDivElement) {
    this.viewingCallbacker.runAfterPageDivInit(pageNum, divWrapper);
  }

}
