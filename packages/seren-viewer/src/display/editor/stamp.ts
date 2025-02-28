/* Copyright 2022 Mozilla Foundation
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

import { AnnotationData, AnnotationEditorType, PlatformHelper, shadow } from "seren-common";
import { AnnotationElement } from "../annotation_layer";
import { OutputScale } from "../display_utils";
import { AnnotationEditor, AnnotationEditorHelper, AnnotationEditorParameters } from "./editor";
import { AnnotationEditorUIManager, CacheImage } from "./tools";
import { L10n } from "../../l10n/l10n";

export interface StampEditorParameter extends AnnotationEditorParameters {
  bitmapFile: File | null;
  name: "stampEditor";
  bitmapUrl: string | null;
}
/**
 * Basic text editor in order to create a FreeTex annotation.
 */
export class StampEditor extends AnnotationEditor {

  #bitmap: ImageBitmap | HTMLImageElement | null = null;

  #bitmapId: string | null = null;

  #bitmapPromise: Promise<void> | null = null;

  #bitmapUrl: string | null = null;

  #bitmapFile: File | null = null;

  #bitmapFileName = "";

  #canvas: HTMLCanvasElement | null = null;

  #observer: ResizeObserver | null = null;

  #resizeTimeoutId: number | null = null;

  #isSvg = false;

  #hasBeenAddedInUndoStack = false;

  static _type = "stamp";

  static _editorType = AnnotationEditorType.STAMP;

  constructor(params: StampEditorParameter) {
    super({ ...params, name: "stampEditor" });
    this.#bitmapUrl = params.bitmapUrl;
    this.#bitmapFile = params.bitmapFile;
  }

  /** @inheritdoc */
  static initialize(l10n: L10n, uiManager: AnnotationEditorUIManager) {
    AnnotationEditorHelper.initialize(l10n, uiManager);
  }

  static get supportedTypes() {
    // See https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Image_types
    // to know which types are supported by the browser.
    const types = [
      "apng",
      "avif",
      "bmp",
      "gif",
      "jpeg",
      "png",
      "svg+xml",
      "webp",
      "x-icon",
    ];
    return shadow(
      this,
      "supportedTypes",
      types.map(type => `image/${type}`)
    );
  }

  static get supportedTypesStr() {
    return shadow(this, "supportedTypesStr", this.supportedTypes.join(","));
  }

  /** @inheritdoc */
  static isHandlingMimeForPasting(mime: string) {
    return this.supportedTypes.includes(mime);
  }


  /** @inheritdoc */
  altTextFinish() {
    if (this._uiManager.useNewAltTextFlow) {
      this.div!.hidden = false;
    }
    super.altTextFinish();
  }

  /** @inheritdoc */
  get telemetryFinalData() {
    return {
      type: "stamp",
      hasAltText: !!this.altTextData?.altText,
    };
  }

  #getBitmapFetched(data: CacheImage | null, fromId = false) {
    if (!data) {
      this.remove();
      return;
    }
    this.#bitmap = data.bitmap;
    if (!fromId) {
      this.#bitmapId = data.id;
      this.#isSvg = data.isSvg;
    }
    if (data.file) {
      this.#bitmapFileName = data.file.name;
    }
    this.#createCanvas();
  }

  #getBitmapDone() {
    this.#bitmapPromise = null;
    this._uiManager.enableWaiting(false);
    if (!this.#canvas) {
      return;
    }
    if (
      this._uiManager.useNewAltTextWhenAddingImage &&
      this._uiManager.useNewAltTextFlow &&
      this.#bitmap
    ) {
      this._editToolbar!.hide();
      this._uiManager.editAltText(this, /* firstTime = */ true);
      return;
    }

    if (
      !this._uiManager.useNewAltTextWhenAddingImage &&
      this._uiManager.useNewAltTextFlow &&
      this.#bitmap
    ) {
      try {
        // The alt-text dialog isn't opened but we still want to guess the alt
        // text.
        this.mlGuessAltText();
      } catch { }
    }

    this.div!.focus();
  }

  async mlGuessAltText(imageData: {
    width: number;
    height: number;
    data: Uint8ClampedArray<ArrayBuffer>;
  } | null = null, updateAltTextData = true) {
    if (this.hasAltTextData()) {
      return null;
    }

    const { mlManager } = this._uiManager;
    if (!mlManager) {
      throw new Error("No ML.");
    }
    if (!(await mlManager.isEnabledFor("altText"))) {
      throw new Error("ML isn't enabled for alt text.");
    }
    const { data, width, height } = imageData ||
      this.copyCanvas(null, null, true).imageData!;
    const response = await mlManager.guess({
      name: "altText",
      request: {
        data, width, height,
        channels: data.length / (width! * height!),
      },
    });
    if (!response) {
      throw new Error("No response from the AI service.");
    }
    if (response.error) {
      throw new Error("Error from the AI service.");
    }
    if (response.cancel) {
      return null;
    }
    if (!response.output) {
      throw new Error("No valid response from the AI service.");
    }
    const altText: string | null = response.output;
    await this.setGuessedAltText(altText);
    if (updateAltTextData && !this.hasAltTextData()) {
      this.altTextData = {
        alt: altText,
        decorative: false,
        altText: null,
        guessedText: null,
        textWithDisclaimer: null,
        cancel: null
      };
    }
    return altText;
  }

  #getBitmap() {
    if (this.#bitmapId) {
      this._uiManager.enableWaiting(true);
      this._uiManager.imageManager
        .getFromId(this.#bitmapId)
        .then(data => this.#getBitmapFetched(data, /* fromId = */ true))
        .finally(() => this.#getBitmapDone());
      return;
    }

    if (this.#bitmapUrl) {
      const url = this.#bitmapUrl;
      this.#bitmapUrl = null;
      this._uiManager.enableWaiting(true);
      this.#bitmapPromise = this._uiManager.imageManager
        .getFromUrl(url)
        .then(data => this.#getBitmapFetched(data))
        .finally(() => this.#getBitmapDone());
      return;
    }

    if (this.#bitmapFile) {
      const file = this.#bitmapFile;
      this.#bitmapFile = null;
      this._uiManager.enableWaiting(true);
      this.#bitmapPromise = this._uiManager.imageManager
        .getFromFile(file)
        .then(data => this.#getBitmapFetched(data))
        .finally(() => this.#getBitmapDone());
      return;
    }

    const input = document.createElement("input");
    if (PlatformHelper.isTesting()) {
      input.hidden = true;
      input.id = "stampEditorFileInput";
      document.body.append(input);
    }
    input.type = "file";
    input.accept = StampEditor.supportedTypesStr;
    const signal = this._uiManager._signal!;
    this.#bitmapPromise = new Promise<void>(resolve => {
      input.addEventListener(
        "change",
        async () => {
          if (!input.files || input.files.length === 0) {
            this.remove();
          } else {
            this._uiManager.enableWaiting(true);
            const data = await this._uiManager.imageManager.getFromFile(
              input.files[0]
            );
            this.#getBitmapFetched(data);
          }
          if (PlatformHelper.isTesting()) {
            input.remove();
          }
          resolve(undefined);
        },
        { signal }
      );
      input.addEventListener(
        "cancel",
        () => {
          this.remove();
          resolve();
        },
        { signal }
      );
    }).finally(() => this.#getBitmapDone());
    if (PlatformHelper.isTesting()) {
      input.click();
    }
  }

  /** @inheritdoc */
  remove() {
    if (this.#bitmapId) {
      this.#bitmap = null;
      this._uiManager.imageManager.deleteId(this.#bitmapId);
      this.#canvas?.remove();
      this.#canvas = null;
      this.#observer?.disconnect();
      this.#observer = null;
      if (this.#resizeTimeoutId) {
        clearTimeout(this.#resizeTimeoutId);
        this.#resizeTimeoutId = null;
      }
    }
    super.remove();
  }

  /** @inheritdoc */
  rebuild() {
    if (!this.parent) {
      // It's possible to have to rebuild an editor which is not on a visible
      // page.
      if (this.#bitmapId) {
        this.#getBitmap();
      }
      return;
    }
    super.rebuild();
    if (this.div === null) {
      return;
    }

    if (this.#bitmapId && this.#canvas === null) {
      this.#getBitmap();
    }

    if (!this.isAttachedToDOM) {
      // At some point this editor was removed and we're rebuilting it,
      // hence we must add it to its parent.
      this.parent.add(this);
    }
  }

  /** @inheritdoc */
  onceAdded() {
    this._isDraggable = true;
    this.div!.focus();
  }

  /** @inheritdoc */
  isEmpty() {
    return !(
      this.#bitmapPromise ||
      this.#bitmap ||
      this.#bitmapUrl ||
      this.#bitmapFile ||
      this.#bitmapId
    );
  }

  /** @inheritdoc */
  get isResizable() {
    return true;
  }

  /** @inheritdoc */
  render() {
    if (this.div) {
      return this.div;
    }

    let baseX, baseY;
    if (this.width) {
      baseX = this.x;
      baseY = this.y;
    }

    super.render();
    this.div!.hidden = true;
    this.div!.setAttribute("role", "figure");

    this.addAltTextButton();

    if (this.#bitmap) {
      this.#createCanvas();
    } else {
      this.#getBitmap();
    }

    if (this.width && !this.annotationElementId) {
      // This editor was created in using copy (ctrl+c).
      const [parentWidth, parentHeight] = this.parentDimensions;
      this.setAt(
        baseX! * parentWidth,
        baseY! * parentHeight,
        this.width * parentWidth,
        this.height * parentHeight
      );
    }

    return this.div;
  }

  #createCanvas() {
    const { div } = this;
    let { width, height } = this.#bitmap!;
    const [pageWidth, pageHeight] = this.pageDimensions;
    const MAX_RATIO = 0.75;
    if (this.width) {
      width = this.width * pageWidth;
      height = this.height * pageHeight;
    } else if (
      width > MAX_RATIO * pageWidth ||
      height > MAX_RATIO * pageHeight
    ) {
      // If the the image is too big compared to the page dimensions
      // (more than MAX_RATIO) then we scale it down.
      const factor = Math.min(
        (MAX_RATIO * pageWidth) / width,
        (MAX_RATIO * pageHeight) / height
      );
      width *= factor;
      height *= factor;
    }
    const [parentWidth, parentHeight] = this.parentDimensions;
    this.setDims(
      (width * parentWidth) / pageWidth,
      (height * parentHeight) / pageHeight
    );

    this._uiManager.enableWaiting(false);
    const canvas = (this.#canvas = document.createElement("canvas"));
    canvas.setAttribute("role", "img");
    this.addContainer(canvas);

    if (
      !this._uiManager.useNewAltTextWhenAddingImage ||
      !this._uiManager.useNewAltTextFlow ||
      this.annotationElementId
    ) {
      div!.hidden = false;
    }
    this.#drawBitmap(width, height);
    this.#createObserver();
    if (!this.#hasBeenAddedInUndoStack) {
      this.parent!.addUndoableEditor(this);
      this.#hasBeenAddedInUndoStack = true;
    }

    if (this.#bitmapFileName) {
      canvas.setAttribute("aria-label", this.#bitmapFileName);
    }
  }

  copyCanvas(maxDataDimension: number | null, maxPreviewDimension: number | null, createImageData = false) {
    if (!maxDataDimension) {
      // TODO: get this value from Firefox
      //   (https://bugzilla.mozilla.org/show_bug.cgi?id=1908184)
      // It's the maximum dimension that the AI can handle.
      maxDataDimension = 224;
    }

    const { width: bitmapWidth, height: bitmapHeight } = this.#bitmap!;
    const outputScale = new OutputScale();

    let bitmap = this.#bitmap!;
    let width = bitmapWidth;
    let height = bitmapHeight;
    let canvas = null;

    if (maxPreviewDimension) {
      if (bitmapWidth > maxPreviewDimension || bitmapHeight > maxPreviewDimension) {
        const ratio = Math.min(
          maxPreviewDimension / bitmapWidth,
          maxPreviewDimension / bitmapHeight
        );
        width = Math.floor(bitmapWidth * ratio);
        height = Math.floor(bitmapHeight * ratio);
      }

      canvas = document.createElement("canvas");
      const scaledWidth = (canvas.width = Math.ceil(width * outputScale.sx));
      const scaledHeight = (canvas.height = Math.ceil(height * outputScale.sy));

      if (!this.#isSvg) {
        bitmap = this.#scaleBitmap(scaledWidth, scaledHeight)!;
      }

      const ctx = canvas.getContext("2d")!;
      ctx.filter = this._uiManager.hcmFilter;

      // Add a checkerboard pattern as a background in case the image has some
      // transparency.
      let white = "white",
        black = "#cfcfd8";
      if (this._uiManager.hcmFilter !== "none") {
        black = "black";
      } else if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
        white = "#8f8f9d";
        black = "#42414d";
      }
      const boxDim = 15;
      const boxDimWidth = boxDim * outputScale.sx;
      const boxDimHeight = boxDim * outputScale.sy;
      const pattern = new OffscreenCanvas(boxDimWidth * 2, boxDimHeight * 2);
      const patternCtx = pattern.getContext("2d")!;
      patternCtx.fillStyle = white;
      patternCtx.fillRect(0, 0, boxDimWidth * 2, boxDimHeight * 2);
      patternCtx.fillStyle = black;
      patternCtx.fillRect(0, 0, boxDimWidth, boxDimHeight);
      patternCtx.fillRect(boxDimWidth, boxDimHeight, boxDimWidth, boxDimHeight);
      ctx.fillStyle = ctx.createPattern(pattern, "repeat")!;
      ctx.fillRect(0, 0, scaledWidth, scaledHeight);
      ctx.drawImage(
        bitmap,
        0,
        0,
        bitmap.width,
        bitmap.height,
        0,
        0,
        scaledWidth,
        scaledHeight
      );
    }

    let imageData = null;
    if (createImageData) {
      let dataWidth, dataHeight;
      if (
        outputScale.symmetric &&
        bitmap.width < maxDataDimension &&
        bitmap.height < maxDataDimension
      ) {
        dataWidth = bitmap.width;
        dataHeight = bitmap.height;
      } else {
        bitmap = this.#bitmap!;
        if (bitmapWidth > maxDataDimension || bitmapHeight > maxDataDimension) {
          const ratio = Math.min(
            maxDataDimension / bitmapWidth,
            maxDataDimension / bitmapHeight
          );
          dataWidth = Math.floor(bitmapWidth * ratio);
          dataHeight = Math.floor(bitmapHeight * ratio);

          if (!this.#isSvg) {
            bitmap = this.#scaleBitmap(dataWidth, dataHeight)!;
          }
        }
      }

      const offscreen = new OffscreenCanvas(dataWidth!, dataHeight!);
      const offscreenCtx = offscreen.getContext("2d", {
        willReadFrequently: true,
      })!;
      offscreenCtx.drawImage(
        bitmap,
        0,
        0,
        bitmap.width,
        bitmap.height,
        0,
        0,
        dataWidth!,
        dataHeight!
      );
      imageData = {
        width: dataWidth,
        height: dataHeight,
        data: offscreenCtx.getImageData(0, 0, dataWidth!, dataHeight!).data,
      };
    }

    return { canvas, width, height, imageData };
  }

  /**
   * When the dimensions of the div change the inner canvas must
   * renew its dimensions, hence it must redraw its own contents.
   * @param {number} width - the new width of the div
   * @param {number} height - the new height of the div
   * @returns
   */
  #setDimensions(width: number, height: number) {
    const [parentWidth, parentHeight] = this.parentDimensions;
    this.width = width / parentWidth;
    this.height = height / parentHeight;
    if (this._initialOptions?.isCentered) {
      this.center();
    } else {
      this.fixAndSetPosition();
    }
    this._initialOptions = null;
    if (this.#resizeTimeoutId !== null) {
      clearTimeout(this.#resizeTimeoutId);
    }
    // When the user is resizing the editor we just use CSS to scale the image
    // to avoid redrawing it too often.
    // And once the user stops resizing the editor we redraw the image in
    // rescaling it correctly (see this.#scaleBitmap).
    const TIME_TO_WAIT = 200;
    this.#resizeTimeoutId = setTimeout(() => {
      this.#resizeTimeoutId = null;
      this.#drawBitmap(width, height);
    }, TIME_TO_WAIT);
  }

  #scaleBitmap(width: number, height: number) {
    const { width: bitmapWidth, height: bitmapHeight } = this.#bitmap!;

    let newWidth = bitmapWidth;
    let newHeight = bitmapHeight;
    let bitmap = this.#bitmap;
    while (newWidth > 2 * width || newHeight > 2 * height) {
      const prevWidth = newWidth;
      const prevHeight = newHeight;

      if (newWidth > 2 * width) {
        // See bug 1820511 (Windows specific bug).
        // TODO: once the above bug is fixed we could revert to:
        // newWidth = Math.ceil(newWidth / 2);
        newWidth =
          newWidth >= 16384
            ? Math.floor(newWidth / 2) - 1
            : Math.ceil(newWidth / 2);
      }
      if (newHeight > 2 * height) {
        newHeight =
          newHeight >= 16384
            ? Math.floor(newHeight / 2) - 1
            : Math.ceil(newHeight / 2);
      }

      const offscreen = new OffscreenCanvas(newWidth, newHeight);
      const ctx = offscreen.getContext("2d")!;
      ctx.drawImage(
        bitmap!,
        0,
        0,
        prevWidth,
        prevHeight,
        0,
        0,
        newWidth,
        newHeight
      );
      bitmap = offscreen.transferToImageBitmap()!;
    }

    return bitmap;
  }

  #drawBitmap(width: number, height: number) {
    const outputScale = new OutputScale();
    const scaledWidth = Math.ceil(width * outputScale.sx);
    const scaledHeight = Math.ceil(height * outputScale.sy);

    const canvas = this.#canvas;
    if (
      !canvas ||
      (canvas.width === scaledWidth && canvas.height === scaledHeight)
    ) {
      return;
    }
    canvas.width = scaledWidth;
    canvas.height = scaledHeight;

    const bitmap = this.#isSvg
      ? this.#bitmap
      : this.#scaleBitmap(scaledWidth, scaledHeight);

    const ctx = canvas.getContext("2d")!;
    ctx.filter = this._uiManager.hcmFilter;
    ctx.drawImage(
      bitmap!,
      0,
      0,
      bitmap!.width,
      bitmap!.height,
      0,
      0,
      scaledWidth,
      scaledHeight
    );
  }

  /** @inheritdoc */
  getImageForAltText() {
    return this.#canvas;
  }

  /**
   * Create the resize observer.
   */
  #createObserver() {
    if (!this._uiManager._signal) {
      // This method is called after the canvas has been created but the canvas
      // creation is async, so it's possible that the viewer has been closed.
      return;
    }
    this.#observer = new ResizeObserver(entries => {
      const rect = entries[0].contentRect;
      if (rect.width && rect.height) {
        this.#setDimensions(rect.width, rect.height);
      }
    });
    this.#observer.observe(this.div!);
    this._uiManager._signal.addEventListener(
      "abort",
      () => {
        this.#observer?.disconnect();
        this.#observer = null;
      },
      { once: true }
    );
  }


  /** @inheritdoc */
  renderAnnotationElement(annotation: AnnotationElement<AnnotationData>) {
    annotation.updateEdited(this.getRect(0, 0));
    return null;
  }
}
