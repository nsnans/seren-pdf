import { AppOptions } from "./viewer_options";

export class WebPDFViewerContext {

  protected appOptions: AppOptions;
  
  constructor(
    appOptions: AppOptions
  ){
    this.appOptions = appOptions;
  }
}
