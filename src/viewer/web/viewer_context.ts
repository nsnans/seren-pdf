import { WebPDFViewerCallbackManager } from './viewer_callback_manager';
import { WebPDFViewerOptions } from './viewer_options';
import { L10n } from './l10n';

export class WebPDFViewerContext {

  protected viewerOptions: WebPDFViewerOptions;

  protected callbackManager: WebPDFViewerCallbackManager;

  protected l10n: L10n;

  constructor(viewerOptions: WebPDFViewerOptions) {
    this.viewerOptions = viewerOptions;
    this.callbackManager = new WebPDFViewerCallbackManager();
  }

  getCallbackManager() {
    return this.callbackManager;
  }

  getViewerOptions() {
    return this.viewerOptions;
  }

  getL10n() {
    return this.l10n;
  }
}
