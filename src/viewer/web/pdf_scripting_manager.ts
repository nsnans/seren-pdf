/* Copyright 2021 Mozilla Foundation
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

/** @typedef {import("./event_utils").EventBus} EventBus */

import { PDFDocumentProxy } from "../../display/api";
import { shadow } from "../../shared/util";

/**
 * @typedef {Object} PDFScriptingManagerOptions
 * @property {EventBus} eventBus - The application event bus.
 * @property {string} [sandboxBundleSrc] - The path and filename of the
 *   scripting bundle.
 * @property {Object} [externalServices] - The factory that is used when
 *   initializing scripting; must contain a `createScripting` method.
 *   PLEASE NOTE: Primarily intended for the default viewer use-case.
 * @property {function} [docProperties] - The function that is used to lookup
 *   the necessary document properties.
 */

export class PDFScriptingManager {

  #destroyCapability: PromiseWithResolvers<void> | null = null;

  #ready = false;

  /**
   * @param {PDFScriptingManagerOptions} options
   */
  constructor() {
  }

  async setDocument(_pdfDocument: PDFDocumentProxy) {
  }

  async dispatchWillSave() {
  }

  async dispatchDidSave() {
  }

  async dispatchWillPrint() {
  }

  async dispatchDidPrint() {
  }

  get destroyPromise() {
    return this.#destroyCapability?.promise || null;
  }

  get ready() {
    return this.#ready;
  }

  /**
   * @private
   */
  get _pageOpenPending() {
    return shadow(this, "_pageOpenPending", new Set());
  }

  /**
   * @private
   */
  get _visitedPages() {
    return shadow(this, "_visitedPages", new Map());
  }
}
