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

const DEFAULT_LINK_REL = "noopener noreferrer nofollow";

export enum LinkTarget {
  NONE = 0, // Default value.
  SELF = 1,
  BLANK = 2,
  PARENT = 3,
  TOP = 4,
};

/**
 * Performs navigation functions inside PDF, such as opening specified page,
 * or destination.
 */
export class PDFLinkService {

  protected externalLinkEnabled = true;

  protected pdfDocument: PDFDocumentProxy | null;

  protected baseUrl: string | null;

  protected externalLinkTarget: number;

  protected externalLinkRel: string;

  protected _ignoreDestinationZoom: boolean;

  public isInPresentationMode = false;

  /**
   * @param externalLinkTarget - Specifies the `target` attribute
   *   for external links. Must use one of the values from {LinkTarget}.
   *   Defaults to using no target.
   * @param externalLinkRel - Specifies the `rel` attribute for
   *   external links. Defaults to stripping the referrer.
   * @param ignoreDestinationZoom - Ignores the zoom argument,
   *   thus preserving the current zoom level in the viewer, when navigating
   *   to internal destinations. The default value is `false`.
   */
  constructor(
    externalLinkTarget: number,
    externalLinkRel: string,
    ignoreDestinationZoom = false,
  ) {
    this.externalLinkTarget = externalLinkTarget;
    this.externalLinkRel = externalLinkRel;
    this._ignoreDestinationZoom = ignoreDestinationZoom;
    this.baseUrl = null;
    this.pdfDocument = null;
  }

  setDocument(pdfDocument: PDFDocumentProxy, baseUrl: string | null = null) {
    this.baseUrl = baseUrl;
    this.pdfDocument = pdfDocument;
  }

  /**
   * This method will, when available, also update the browser history.
   *
   * @param _dest - The named, or explicit, PDF destination.
   */
  async goToDestination(_dest: string | Array<string>) {
    // 不明确的代码先移除，后面调试的时候重新设计或者开发
  }

  /**
   * This method will, when available, also update the browser history.
   *
   * @param _val - The page number, or page label.
   */
  goToPage(_val: number | string) {
    // 不明确的代码先移除，后面调试的时候重新设计或者开发
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
  getDestinationHash(dest: string) {
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
  async executeSetOCGState(_action: { state: string[], preserveRB: boolean; }) {

  }
}
