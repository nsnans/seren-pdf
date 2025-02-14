/* Copyright 2015 Mozilla Foundation
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

import { PDFDocumentProxy } from "../../display/api";
import { parseQueryString } from "../common/ui_utils";

/** @typedef {import("./event_utils").EventBus} EventBus */
/** @typedef {import("./interfaces").IPDFLinkService} IPDFLinkService */


const DEFAULT_LINK_REL = "noopener noreferrer nofollow";

export enum LinkTarget {
  NONE = 0, // Default value.
  SELF = 1,
  BLANK = 2,
  PARENT = 3,
  TOP = 4,
};

/**
 * @typedef {Object} PDFLinkServiceOptions
 * @property {EventBus} eventBus - The application event bus.
 * @property {number} [externalLinkTarget] - Specifies the `target` attribute
 *   for external links. Must use one of the values from {LinkTarget}.
 *   Defaults to using no target.
 * @property {string} [externalLinkRel] - Specifies the `rel` attribute for
 *   external links. Defaults to stripping the referrer.
 * @property {boolean} [ignoreDestinationZoom] - Ignores the zoom argument,
 *   thus preserving the current zoom level in the viewer, when navigating
 *   to internal destinations. The default value is `false`.
 */

/**
 * Performs navigation functions inside PDF, such as opening specified page,
 * or destination.
 * @implements {IPDFLinkService}
 */
class PDFLinkService {

  protected externalLinkEnabled = true;

  protected pdfDocument: PDFDocumentProxy | null;

  protected baseUrl: string | null;

  /**
   * @param {PDFLinkServiceOptions} options
   */
  constructor({
    eventBus,
    externalLinkTarget = null,
    externalLinkRel = null,
    ignoreDestinationZoom = false,
  } = {}) {
    this.eventBus = eventBus;
    this.externalLinkTarget = externalLinkTarget;
    this.externalLinkRel = externalLinkRel;
    this._ignoreDestinationZoom = ignoreDestinationZoom;

    this.baseUrl = null;
    this.pdfDocument = null;
    this.pdfViewer = null;
  }

  setDocument(pdfDocument: PDFDocumentProxy, baseUrl = null) {
    this.baseUrl = baseUrl;
    this.pdfDocument = pdfDocument;
  }

  setViewer(pdfViewer) {
    this.pdfViewer = pdfViewer;
  }

  /**
   * @type {number}
   */
  get pagesCount() {
    return this.pdfDocument ? this.pdfDocument.numPages : 0;
  }

  /**
   * @type {number}
   */
  get page() {
    return this.pdfDocument ? this.pdfViewer.currentPageNumber : 1;
  }

  /**
   * @param {number} value
   */
  set page(value) {
    if (this.pdfDocument) {
      this.pdfViewer.currentPageNumber = value;
    }
  }

  /**
   * @type {number}
   */
  get rotation() {
    return this.pdfDocument ? this.pdfViewer.pagesRotation : 0;
  }

  /**
   * @param {number} value
   */
  set rotation(value) {
    if (this.pdfDocument) {
      this.pdfViewer.pagesRotation = value;
    }
  }

  /**
   * @type {boolean}
   */
  get isInPresentationMode() {
    return this.pdfDocument ? this.pdfViewer.isInPresentationMode : false;
  }

  /**
   * This method will, when available, also update the browser history.
   *
   * @param {string|Array} dest - The named, or explicit, PDF destination.
   */
  async goToDestination(dest) {
    if (!this.pdfDocument) {
      return;
    }
    let namedDest, explicitDest, pageNumber;
    if (typeof dest === "string") {
      namedDest = dest;
      explicitDest = await this.pdfDocument.getDestination(dest);
    } else {
      namedDest = null;
      explicitDest = await dest;
    }
    if (!Array.isArray(explicitDest)) {
      console.error(
        `goToDestination: "${explicitDest}" is not a valid destination array, for dest="${dest}".`
      );
      return;
    }
    // Dest array looks like that: <page-ref> </XYZ|/FitXXX> <args..>
    const [destRef] = explicitDest;

    if (destRef && typeof destRef === "object") {
      pageNumber = this.pdfDocument.cachedPageNumber(destRef);

      if (!pageNumber) {
        // Fetch the page reference if it's not yet available. This could
        // only occur during loading, before all pages have been resolved.
        try {
          pageNumber = (await this.pdfDocument.getPageIndex(destRef)) + 1;
        } catch {
          console.error(
            `goToDestination: "${destRef}" is not a valid page reference, for dest="${dest}".`
          );
          return;
        }
      }
    } else if (Number.isInteger(destRef)) {
      pageNumber = destRef + 1;
    }
    if (!pageNumber || pageNumber < 1 || pageNumber > this.pagesCount) {
      console.error(
        `goToDestination: "${pageNumber}" is not a valid page number, for dest="${dest}".`
      );
      return;
    }

    this.pdfViewer.scrollPageIntoView({
      pageNumber,
      destArray: explicitDest,
      ignoreDestinationZoom: this._ignoreDestinationZoom,
    });
  }

  /**
   * This method will, when available, also update the browser history.
   *
   * @param {number|string} val - The page number, or page label.
   */
  goToPage(val) {
    if (!this.pdfDocument) {
      return;
    }
    const pageNumber =
      (typeof val === "string" && this.pdfViewer.pageLabelToPageNumber(val)) ||
      val | 0;
    if (
      !(
        Number.isInteger(pageNumber) &&
        pageNumber > 0 &&
        pageNumber <= this.pagesCount
      )
    ) {
      console.error(`PDFLinkService.goToPage: "${val}" is not a valid page.`);
      return;
    }
    this.pdfViewer.scrollPageIntoView({ pageNumber });
  }

  /**
   * Adds various attributes (href, title, target, rel) to hyperlinks.
   */
  addLinkAttributes(link: HTMLAnchorElement, url: string, newWindow = false) {
    if (!url || typeof url !== "string") {
      throw new Error('A valid "url" parameter must provided.');
    }
    const target = newWindow ? LinkTarget.BLANK : this.externalLinkTarget,
      rel = this.externalLinkRel;

    if (this.externalLinkEnabled) {
      link.href = link.title = url;
    } else {
      link.href = "";
      link.title = `Disabled: ${url}`;
      link.onclick = () => false;
    }

    let targetStr = ""; // LinkTarget.NONE
    switch (target) {
      case LinkTarget.NONE:
        break;
      case LinkTarget.SELF:
        targetStr = "_self";
        break;
      case LinkTarget.BLANK:
        targetStr = "_blank";
        break;
      case LinkTarget.PARENT:
        targetStr = "_parent";
        break;
      case LinkTarget.TOP:
        targetStr = "_top";
        break;
    }
    link.target = targetStr;

    link.rel = typeof rel === "string" ? rel : DEFAULT_LINK_REL;
  }

  /**
   * @param {string|Array} dest - The PDF destination object.
   * @returns {string} The hyperlink to the PDF object.
   */
  getDestinationHash(dest) {
    if (typeof dest === "string") {
      if (dest.length > 0) {
        return this.getAnchorUrl("#" + escape(dest));
      }
    } else if (Array.isArray(dest)) {
      const str = JSON.stringify(dest);
      if (str.length > 0) {
        return this.getAnchorUrl("#" + escape(str));
      }
    }
    return this.getAnchorUrl("");
  }

  /**
   * Prefix the full url on anchor links to make sure that links are resolved
   * relative to the current URL instead of the one defined in <base href>.
   * @param anchor - The anchor hash, including the #.
   * @returns The hyperlink to the PDF object.
   */
  getAnchorUrl(anchor: string) {
    return this.baseUrl ? this.baseUrl + anchor : anchor;
  }

  /**
   * @param {Object} action
   */
  async executeSetOCGState(action) {
    if (!this.pdfDocument) {
      return;
    }
    const pdfDocument = this.pdfDocument,
      optionalContentConfig = await this.pdfViewer.optionalContentConfigPromise;

    if (pdfDocument !== this.pdfDocument) {
      return; // The document was closed while the optional content resolved.
    }
    optionalContentConfig.setOCGState(action);

    this.pdfViewer.optionalContentConfigPromise = Promise.resolve(
      optionalContentConfig
    );
  }
}

/**
 * @implements {IPDFLinkService}
 */
class SimpleLinkService extends PDFLinkService {
  setDocument(_pdfDocument: PDFDocumentProxy, _baseUrl = null) { }
}

export { LinkTarget, PDFLinkService, SimpleLinkService };
