/* Copyright 2017 Mozilla Foundation
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

import { shadow, } from "seren-common";
import { GrabToPan } from "./grab_to_pan";
import { CursorTool } from "seren-viewer";

export interface ViewerCursorCallbacks {

  onCursorToolChanegd(source: WebViewerCursorManager, tool: CursorTool): void;

}

export class WebViewerCursorManager {

  #active = CursorTool.SELECT;

  #prevActive = null;

  protected container: HTMLDivElement;

  protected callbacks: ViewerCursorCallbacks | null;

  /**
   * 与其说是控制鼠标的类型，不如说是控制操作的类型。
   * 
   * @param container - The document container.
   * @param cursorToolOnLoad - The cursor tool that will be enabled
   *   on load; the constants from {CursorTool} should be used. The default value
   *   is `CursorTool.SELECT`.
   * @param callbacks - 触发事件时的回调。
   */
  constructor(
    container: HTMLDivElement,
    cursorToolOnLoad = CursorTool.SELECT,
    callbacks: ViewerCursorCallbacks | null = null,
  ) {

    this.container = container;
    this.callbacks = callbacks;

    // Defer the initial `switchTool` call, to give other viewer components
    // time to initialize *and* register 'cursortoolchanged' event listeners.
    Promise.resolve().then(() => {
      this.switchTool(cursorToolOnLoad);
    });
  }

  /**
   * @type {number} One of the values in {CursorTool}.
   */
  get activeTool() {
    return this.#active;
  }

  /**
   * @param tool - The cursor mode that should be switched to,
   *    must be one of the values in {CursorTool}.
   */
  switchTool(tool: CursorTool) {
    if (this.#prevActive !== null) {
      // Cursor tools cannot be used in PresentationMode/AnnotationEditor.
      return;
    }
    this.#switchTool(tool);
  }

  #switchTool(tool: CursorTool, _disabled = false) {
    if (tool === this.#active) {
      if (this.#prevActive !== null) {
        // Ensure that the `disabled`-attribute of the buttons will be updated.
        this.callbacks?.onCursorToolChanegd(this, tool);
      }
      return; // The requested tool is already active.
    }

    const disableActiveTool = () => {
      switch (this.#active) {
        case CursorTool.SELECT:
          break;
        case CursorTool.HAND:
          this._handTool.deactivate();
          break;
        case CursorTool.ZOOM:
        /* falls through */
      }
    };

    // Enable the new cursor tool.
    switch (tool) {
      case CursorTool.SELECT:
        disableActiveTool();
        break;
      case CursorTool.HAND:
        disableActiveTool();
        this._handTool.activate();
        break;
      case CursorTool.ZOOM:
      /* falls through */
      default:
        console.error(`switchTool: "${tool}" is an unsupported value.`);
        return;
    }
    // Update the active tool *after* it has been validated above,
    // in order to prevent setting it to an invalid state.
    this.#active = tool;

    this.callbacks?.onCursorToolChanegd(this, tool);
  }

  protected get _handTool() {
    return shadow(this, "_handTool", new GrabToPan(this.container));
  }
}
