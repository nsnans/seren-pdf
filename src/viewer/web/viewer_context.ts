import { GenericWebViewerCallbackManager, WebViewerCallbackManager } from './viewer_callback_manager';
import { WebPDFViewerOptions } from './viewer_options';
import { L10n } from './l10n';
import { GenericL10n } from './genericl10n';

export class WebPDFViewerContext {

  protected viewerOptions: WebPDFViewerOptions;

  protected callbackManager: WebViewerCallbackManager;

  protected l10n: L10n;

  constructor(viewerOptions: WebPDFViewerOptions) {
    this.viewerOptions = viewerOptions;
    this.callbackManager = new GenericWebViewerCallbackManager();
    this.l10n = new GenericL10n();
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
