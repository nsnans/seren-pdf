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

import { PlatformHelper } from "../../../seren-common/src/platform_helper";
import { unreachable } from "../shared/util";

export interface CanvasAndContext {
  savedCtx?: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement | null;
  context: CanvasRenderingContext2D | null;
};

export interface CanvasFactory {

  create(width: number, height: number): CanvasAndContext;

  reset(canvasAndContext: CanvasAndContext, width: number, height: number): void;

  destroy(canvasAndContext: CanvasAndContext): void;

  _createCanvas(width: number, height: number): HTMLCanvasElement;

}

export abstract class BaseCanvasFactory implements CanvasFactory {

  // 硬件加速 hardware accelerate
  protected _enableHWA = false;

  constructor(enableHWA = false) {
    if (PlatformHelper.isTesting() && this.constructor === BaseCanvasFactory) {
      unreachable("Cannot initialize BaseCanvasFactory.");
    }
    this._enableHWA = enableHWA;
  }

  create(width: number, height: number) {
    if (width <= 0 || height <= 0) {
      throw new Error("Invalid canvas size");
    }
    const canvas = this._createCanvas(width, height);
    return {
      canvas,
      context: canvas.getContext("2d", {
        willReadFrequently: !this._enableHWA,
      })!,
    };
  }

  reset(canvasAndContext: CanvasAndContext, width: number, height: number) {
    if (!canvasAndContext.canvas) {
      throw new Error("Canvas is not specified");
    }
    if (width <= 0 || height <= 0) {
      throw new Error("Invalid canvas size");
    }
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }

  destroy(canvasAndContext: CanvasAndContext) {
    if (!canvasAndContext.canvas) {
      throw new Error("Canvas is not specified");
    }
    // Zeroing the width and height cause Firefox to release graphics
    // resources immediately, which can greatly reduce memory consumption.
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }

  /**
   * @ignore
   */
  abstract _createCanvas(width: number, height: number): HTMLCanvasElement;
}

export class DOMCanvasFactory extends BaseCanvasFactory {

  protected _document: Document;

  constructor(document: Document, enableHWA = false) {
    super(enableHWA);
    this._document = document;
  }

  /**
   * @ignore
   */
  _createCanvas(width: number, height: number) {
    const canvas = this._document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
}

