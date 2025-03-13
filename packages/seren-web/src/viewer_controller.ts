import { PageViewArrange } from './arrange/view_arrange';

export class WebViewerController {

  protected viewArrange: PageViewArrange;

  constructor(viewArrange: PageViewArrange) {
    this.viewArrange = viewArrange;
  }

  pageUp() {
    this.viewArrange.pageUp();
  }

  pageDown() {
    this.viewArrange.pageDown();
  }
}