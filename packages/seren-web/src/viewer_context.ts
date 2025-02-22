import { GenericL10n } from './genericl10n';
import { L10n } from './l10n';
import { GenericWebViewerCallbackManager, WebViewerCallbackManager } from './viewer_callback_manager';
import { WebPDFViewerGeneralOptions } from './viewer_options';

export class WebPDFViewerContext {

  protected viewerOptions: WebPDFViewerGeneralOptions;

  protected callbackManager: WebViewerCallbackManager;

  protected l10n: L10n;

  constructor(viewerOptions: WebPDFViewerGeneralOptions) {
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
