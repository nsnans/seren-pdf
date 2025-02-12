

export interface WebPDFViewerCallbackManager {
}

/**
 * 只能暴露部分的接口给用户
 */
export class GenericWebPDFViewerCallbackManager implements WebPDFViewerCallbackManager {

  protected interalCallbackManager: InteralWebPDFViewerCallbackManager;

  constructor(interalCallbackManager: InteralWebPDFViewerCallbackManager) {
    this.interalCallbackManager = interalCallbackManager;
  }
}

export class InteralWebPDFViewerCallbackManager implements WebPDFViewerCallbackManager {

}
