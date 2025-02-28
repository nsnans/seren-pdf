/* Copyright 2012 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { RenderingCancelledException, RenderingStates } from "seren-viewer";
import { WebPDFPageView } from "./page_view";
import { WebPageViewManager } from './page_view_manager';
import { WebThumbnailViewService } from "./thumbnail_view_service";

// const CLEANUP_TIMEOUT = 30000;

/**
 * Controls rendering of the views for pages and thumbnails.
 */
export class PDFRenderingManager {

  protected viewManager: WebPageViewManager | null;

  protected idleTimeout: number | null;

  protected printing: boolean;

  protected isThumbnailViewEnabled: boolean;

  protected pdfThumbnailViewer: WebThumbnailViewService | null;

  protected onIdle: number | null;

  constructor() {
    this.viewManager = null;
    this.pdfThumbnailViewer = null;
    this.onIdle = null;
    this.idleTimeout = null;
    this.printing = false;
    this.isThumbnailViewEnabled = false;
  }

  setViewer(viewManager: WebPageViewManager) {
    this.viewManager = viewManager;
  }

  setThumbnailViewService(thumbnailViewService: WebThumbnailViewService) {
    this.pdfThumbnailViewer = thumbnailViewService;
  }

  isViewFinished(view: WebPDFPageView) {
    return view.renderingState === RenderingStates.FINISHED;
  }

  /**
   * Render a page or thumbnail view. This calls the appropriate function
   * based on the views state. If the view is already rendered it will return
   * `false`.
   *
   * @param {IRenderableView} view
   */
  renderView(view: WebPDFPageView) {
    switch (view.renderingState) {
      case RenderingStates.FINISHED:
        return false;
      case RenderingStates.PAUSED:
        break;
      case RenderingStates.RUNNING:
        break;
      case RenderingStates.INITIAL:
        view.draw()
          .finally(() => {
          })
          .catch((reason: unknown) => {
            if (reason instanceof RenderingCancelledException) {
              return;
            }
            console.error(`renderView: "${reason}"`);
          });
        break;
    }
    return true;
  }
}
