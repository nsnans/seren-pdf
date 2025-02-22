
export interface WebViewerCallbackManager {
}

/**
 * 只能暴露部分的接口给用户
 */
export class GenericWebViewerCallbackManager implements WebViewerCallbackManager {

  constructor() {
  }

  onPDFDocumentLoaded() {

  }
}

export class InteralWebViewerCallbackManager implements WebViewerCallbackManager {

}

