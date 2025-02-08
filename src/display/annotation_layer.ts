/* Copyright 2014 Mozilla Foundation
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

/** @typedef {import("./api").PDFPageProxy} PDFPageProxy */
// eslint-disable-next-line max-len
/** @typedef {import("../../web/text_accessibility.js").TextAccessibilityManager} TextAccessibilityManager */
// eslint-disable-next-line max-len
/** @typedef {import("../../web/interfaces").IDownloadManager} IDownloadManager */
/** @typedef {import("../../web/interfaces").IPDFLinkService} IPDFLinkService */
// eslint-disable-next-line max-len
/** @typedef AnnotationEditorUIManager */
// eslint-disable-next-line max-len
/** @typedef {import("../../web/struct_tree_layer_builder.js").StructTreeLayerBuilder} StructTreeLayerBuilder */

import { AnnotationBorderStyle, AnnotationData, ButtonWidgetData, CaretData, CircleData, FileAttachmentData, FreeTextData, HighlightData, InkAnnotationData, LineData, LinkData, PolylineData, PopupData, SquareData, SquigglyData, StampData, StrikeOutData, StringObj, TextData, UnderlineData, WidgetData } from "../core/annotation";
import { PlatformHelper } from "../platform/platform_helper";
import { ColorConverters, RGBType } from "../shared/scripting_utils";
import {
  AnnotationBorderStyleType,
  AnnotationEditorType,
  AnnotationPrefix,
  AnnotationType,
  FeatureTest,
  LINE_FACTOR,
  shadow,
  unreachable,
  Util,
  warn,
} from "../shared/util";
import { DownloadManager, PDFLinkService } from "../viewer/common/component_types";
import { TextAccessibilityManager } from "../viewer/common/text_accessibility";
import { AnnotationStorage } from "./annotation_storage";
import { PDFPageProxy } from "./api";
import { PageViewport, PDFDateString, PointType, RectType, setLayerDimensions } from "./display_utils";
import { AnnotationEditorUIManager } from "./editor/tools";
import { BaseSVGFactory, DOMSVGFactory } from "./svg_factory";

const DEFAULT_TAB_INDEX = 1000;
const DEFAULT_FONT_SIZE = 9;
const GetElementsByNameSet = new WeakSet();

function getRectDims(rect: RectType) {
  return {
    width: rect[2] - rect[0],
    height: rect[3] - rect[1],
  };
}

/**
 * @typedef {Object} AnnotationElementParameters
 * @property {Object} data
 * @property {HTMLDivElement} layer
 * @property {PDFLinkService} linkService
 * @property {DownloadManager} [downloadManager]
 * @property {AnnotationStorage} [annotationStorage]
 * @property {string} [imageResourcesPath] - Path for image resources, mainly
 *   for annotation icons. Include trailing slash.
 * @property {boolean} renderForms
 * @property {Object} svgFactory
 * @property {boolean} [enableScripting]
 * @property {boolean} [hasJSActions]
 * @property {Object} [fieldObjects]
 */

export interface AnnotationElementParameters<DATA> {
  data: DATA;
  layer: HTMLDivElement;
  linkService: PDFLinkService;
  downloadManager: DownloadManager;
  annotationStorage: AnnotationStorage;
  imageResourcesPath: string;
  renderForms: boolean;
  // 姑且先按照注释里的来
  svgFactory: BaseSVGFactory;
  enableScripting: boolean;
  hasJSActions: boolean;
  fieldObjects: object;
  elements: AnnotationElement<AnnotationData>[];
  parent: AnnotationLayer;
}

class AnnotationElementFactory {

  static create(parameters: AnnotationElementParameters<AnnotationData>): AnnotationElement<AnnotationData> {

    const subtype = parameters.data.annotationType;

    switch (subtype) {
      case AnnotationType.LINK:
        return new LinkAnnotationElement(<AnnotationElementParameters<LinkData>>parameters);

      case AnnotationType.TEXT:
        return new TextAnnotationElement(<AnnotationElementParameters<TextData>>parameters);

      case AnnotationType.WIDGET:
        const fieldType = (<AnnotationElementParameters<WidgetData>>parameters).data.fieldType;

        switch (fieldType) {
          case "Tx":
            return new TextWidgetAnnotationElement(<AnnotationElementParameters<TextData>>parameters);
          case "Btn":
            if ((<ButtonWidgetData>(parameters.data)).radioButton) {
              return new RadioButtonWidgetAnnotationElement(<AnnotationElementParameters<ButtonWidgetData>>parameters);
            } else if ((<ButtonWidgetData>(parameters.data)).checkBox) {
              return new CheckboxWidgetAnnotationElement(<AnnotationElementParameters<ButtonWidgetData>>parameters);
            }
            return new PushButtonWidgetAnnotationElement(<AnnotationElementParameters<ButtonWidgetData>>parameters);
          case "Ch":
            return new ChoiceWidgetAnnotationElement(<AnnotationElementParameters<ButtonWidgetData>>parameters);
          case "Sig":
            return new SignatureWidgetAnnotationElement(<AnnotationElementParameters<ButtonWidgetData>>parameters);
        }
        return new WidgetAnnotationElement(<AnnotationElementParameters<WidgetData>>parameters);

      case AnnotationType.POPUP:
        return new PopupAnnotationElement(<AnnotationElementParameters<PopupData>>parameters);

      case AnnotationType.FREETEXT:
        return new FreeTextAnnotationElement(<AnnotationElementParameters<FreeTextData>>parameters);

      case AnnotationType.LINE:
        return new LineAnnotationElement(<AnnotationElementParameters<LineData>>parameters);

      case AnnotationType.SQUARE:
        return new SquareAnnotationElement(<AnnotationElementParameters<SquareData>>parameters);

      case AnnotationType.CIRCLE:
        return new CircleAnnotationElement(<AnnotationElementParameters<CircleData>>parameters);

      case AnnotationType.POLYLINE:
        return new PolylineAnnotationElement(<AnnotationElementParameters<PolylineData>>parameters);

      case AnnotationType.CARET:
        return new CaretAnnotationElement(<AnnotationElementParameters<CaretData>>parameters);

      case AnnotationType.INK:
        return new InkAnnotationElement(<AnnotationElementParameters<InkAnnotationData>>parameters);

      case AnnotationType.POLYGON:
        return new PolygonAnnotationElement(<AnnotationElementParameters<PolylineData>>parameters);

      case AnnotationType.HIGHLIGHT:
        return new HighlightAnnotationElement(<AnnotationElementParameters<HighlightData>>parameters);

      case AnnotationType.UNDERLINE:
        return new UnderlineAnnotationElement(<AnnotationElementParameters<UnderlineData>>parameters);

      case AnnotationType.SQUIGGLY:
        return new SquigglyAnnotationElement(<AnnotationElementParameters<SquigglyData>>parameters);

      case AnnotationType.STRIKEOUT:
        return new StrikeOutAnnotationElement(<AnnotationElementParameters<StrikeOutData>>parameters);

      case AnnotationType.STAMP:
        return new StampAnnotationElement(<AnnotationElementParameters<StampData>>parameters);

      case AnnotationType.FILEATTACHMENT:
        return new FileAttachmentAnnotationElement(<AnnotationElementParameters<FileAttachmentData>>parameters);

      default:
        return new AnnotationElement(parameters);
    }
  }
}

export class AnnotationElement<DATA extends AnnotationData> {

  protected _updates: { rect: RectType } | null = null;

  protected _hasBorder = false;

  protected _popupElement: PopupAnnotationElement | null = null;

  readonly isRenderable: boolean;

  public data: DATA;

  public annotationEditorType: AnnotationEditorType | null = null;

  protected layer: HTMLDivElement;

  protected linkService: PDFLinkService;

  protected downloadManager: DownloadManager;

  protected imageResourcesPath: string;

  protected renderForms: boolean;

  protected svgFactory: BaseSVGFactory;

  protected annotationStorage: AnnotationStorage;

  protected enableScripting: boolean;

  protected hasJSActions: boolean;

  protected _fieldObjects: object;

  protected parent: AnnotationLayer;

  public container: HTMLElement | null = null;

  public popup: PopupElement | null = null;

  constructor(
    parameters: AnnotationElementParameters<DATA>,
    isRenderable = false,
    ignoreBorder = false,
    createQuadrilaterals = false,
  ) {
    this.isRenderable = isRenderable;
    this.data = parameters.data;
    this.layer = parameters.layer;
    this.linkService = parameters.linkService;
    this.downloadManager = parameters.downloadManager;
    this.imageResourcesPath = parameters.imageResourcesPath;
    this.renderForms = parameters.renderForms;
    this.svgFactory = parameters.svgFactory;
    this.annotationStorage = parameters.annotationStorage;
    this.enableScripting = parameters.enableScripting;
    this.hasJSActions = parameters.hasJSActions;
    this._fieldObjects = parameters.fieldObjects;
    this.parent = parameters.parent;

    if (isRenderable) {
      this.container = this._createContainer(ignoreBorder);
    }
    if (createQuadrilaterals) {
      this._createQuadrilaterals();
    }
  }

  static _hasPopupData(
    titleObj: StringObj | null,
    contentsObj: StringObj | null,
    richText: StringObj | null
  ) {
    return !!(titleObj?.str || contentsObj?.str || richText?.str);
  }

  get _isEditable() {
    return this.data.isEditable;
  }

  get hasPopupData() {
    return AnnotationElement._hasPopupData(
      this.data.titleObj, this.data.contentsObj, this.data.richText
    );
  }

  updateEdited(rect: RectType | null, popupContent: string | null = null) {
    if (!this.container) {
      return;
    }

    this._updates ||= {
      rect: <RectType>this.data.rect!.slice(0),
    };

    if (rect) {
      this.#setRectEdited(rect);
    }

    this._popupElement?.popup!.updateEdited(rect, popupContent);
  }

  resetEdited() {
    if (!this._updates) {
      return;
    }
    this.#setRectEdited(this._updates.rect);
    this._popupElement?.popup!.resetEdited();
    this._updates = null;
  }

  #setRectEdited(rect: RectType) {
    const style = this.container!.style;
    const {
      data: { rect: currentRect, rotation },
      parent: {
        viewport: {
          rawDims: { pageWidth, pageHeight, pageX, pageY },
        },
      },
    } = this;
    currentRect?.splice(0, 4, ...rect);
    const { width, height } = getRectDims(rect);
    style.left = `${(100 * (rect[0] - pageX)) / pageWidth}%`;
    style.top = `${(100 * (pageHeight - rect[3] + pageY)) / pageHeight}%`;
    if (rotation === 0) {
      style.width = `${(100 * width) / pageWidth}%`;
      style.height = `${(100 * height) / pageHeight}%`;
    } else {
      this.setRotation(rotation);
    }
  }

  /**
   * Create an empty container for the annotation's HTML element.
   *
   * @private
   * @param {boolean} ignoreBorder
   * @memberof AnnotationElement
   * @returns {HTMLElement} A section element.
   */
  _createContainer(ignoreBorder: boolean) {
    const {
      data,
      parent: { page, viewport },
    } = this;

    const container = document.createElement("section");
    container.setAttribute("data-annotation-id", data.id);
    if (!(this instanceof WidgetAnnotationElement)) {
      container.tabIndex = DEFAULT_TAB_INDEX;
    }
    const { style } = container;

    // The accessibility manager will move the annotation in the DOM in
    // order to match the visual ordering.
    // But if an annotation is above an other one, then we must draw it
    // after the other one whatever the order is in the DOM, hence the
    // use of the z-index.
    style.zIndex = `${this.parent.zIndex++}`;

    if (data.alternativeText) {
      container.title = data.alternativeText;
    }

    if (data.noRotate) {
      container.classList.add("norotate");
    }

    if (!data.rect || this instanceof PopupAnnotationElement) {
      const { rotation } = data;
      if (!data.hasOwnCanvas && rotation !== 0) {
        this.setRotation(rotation, container);
      }
      return container;
    }

    const { width, height } = getRectDims(data.rect);

    if (!ignoreBorder && data.borderStyle.width > 0) {
      style.borderWidth = `${data.borderStyle.width}px`;

      const horizontalRadius = data.borderStyle.horizontalCornerRadius;
      const verticalRadius = data.borderStyle.verticalCornerRadius;
      if (horizontalRadius > 0 || verticalRadius > 0) {
        const radius = `calc(${horizontalRadius}px * var(--scale-factor)) / calc(${verticalRadius}px * var(--scale-factor))`;
        style.borderRadius = radius;
      } else if (this instanceof RadioButtonWidgetAnnotationElement) {
        const radius = `calc(${width}px * var(--scale-factor)) / calc(${height}px * var(--scale-factor))`;
        style.borderRadius = radius;
      }

      switch (data.borderStyle.style) {
        case AnnotationBorderStyleType.SOLID:
          style.borderStyle = "solid";
          break;

        case AnnotationBorderStyleType.DASHED:
          style.borderStyle = "dashed";
          break;

        case AnnotationBorderStyleType.BEVELED:
          warn("Unimplemented border style: beveled");
          break;

        case AnnotationBorderStyleType.INSET:
          warn("Unimplemented border style: inset");
          break;

        case AnnotationBorderStyleType.UNDERLINE:
          style.borderBottomStyle = "solid";
          break;

        default:
          break;
      }

      const borderColor = data.borderColor || null;
      if (borderColor) {
        this._hasBorder = true;
        style.borderColor = Util.makeHexColor(
          borderColor[0] | 0,
          borderColor[1] | 0,
          borderColor[2] | 0
        );
      } else {
        // Transparent (invisible) border, so do not draw it at all.
        style.borderWidth = "0";
      }
    }

    // Do *not* modify `data.rect`, since that will corrupt the annotation
    // position on subsequent calls to `_createContainer` (see issue 6804).
    const rect = Util.normalizeRect([
      data.rect[0],
      page.view[3] - data.rect[1] + page.view[1],
      data.rect[2],
      page.view[3] - data.rect[3] + page.view[1],
    ]);
    const { pageWidth, pageHeight, pageX, pageY } = viewport.rawDims;

    style.left = `${(100 * (rect[0] - pageX)) / pageWidth}%`;
    style.top = `${(100 * (rect[1] - pageY)) / pageHeight}%`;

    const { rotation } = data;
    if (data.hasOwnCanvas || rotation === 0) {
      style.width = `${(100 * width) / pageWidth}%`;
      style.height = `${(100 * height) / pageHeight}%`;
    } else {
      this.setRotation(rotation, container);
    }

    return container;
  }

  setRotation(angle: number, container = this.container!) {
    if (!this.data.rect) {
      return;
    }
    const { pageWidth, pageHeight } = this.parent.viewport.rawDims;
    const { width, height } = getRectDims(this.data.rect);

    let elementWidth, elementHeight;
    if (angle % 180 === 0) {
      elementWidth = (100 * width) / pageWidth;
      elementHeight = (100 * height) / pageHeight;
    } else {
      elementWidth = (100 * height) / pageWidth;
      elementHeight = (100 * width) / pageHeight;
    }

    container.style.width = `${elementWidth}%`;
    container.style.height = `${elementHeight}%`;

    container.setAttribute("data-main-rotation", `${(360 - angle) % 360}`);
  }

  get _commonActions() {
    const setColor = (jsName: string, styleName: string, event: CustomEvent) => {
      const color = event.detail[jsName];
      const colorType = color[0];
      const colorArray = color.slice(1);
      (<HTMLElement>event.target!).style.setProperty(styleName, ColorConverters.executeHTML(
        <keyof ColorConverters>`${colorType}_HTML`, colorArray
      ));
      this.annotationStorage.setValue(this.data.id, {
        [styleName]: ColorConverters.executeRgb(
          <keyof ColorConverters>`${colorType}_rgb`, colorArray
        ),
      });
    };

    return shadow(this, "_commonActions", {
      display: (event: CustomEvent<{ display: number }>) => {
        const { display } = event.detail;
        // See scripting/constants.js for the values of `Display`.
        // 0 = visible, 1 = hidden, 2 = noPrint and 3 = noView.
        const hidden = display % 2 === 1;
        this.container!.style.visibility = hidden ? "hidden" : "visible";
        this.annotationStorage.setValue(this.data.id, {
          noView: hidden,
          noPrint: display === 1 || display === 2,
        });
      },
      print: (event: CustomEvent<{ print: boolean }>) => {
        this.annotationStorage.setValue(this.data.id, {
          noPrint: !event.detail.print,
        });
      },
      hidden: (event: CustomEvent<{ hidden: boolean }>) => {
        const { hidden } = event.detail;
        this.container!.style.visibility = hidden ? "hidden" : "visible";
        this.annotationStorage.setValue(this.data.id, {
          noPrint: hidden,
          noView: hidden,
        });
      },
      focus: (event: Event) => {
        setTimeout(() => (<HTMLElement>event.target).focus({ preventScroll: false }), 0);
      },
      userName: (event: CustomEvent<{ userName: string }>) => {
        // tooltip
        (<HTMLElement>event.target).title = event.detail.userName;
      },
      readonly: (event: CustomEvent<{ readonly: boolean }>) => {
        (<HTMLInputElement>event.target).disabled = event.detail.readonly;
      },
      required: (event: CustomEvent<{ required: boolean }>) => {
        this._setRequired(<HTMLElement>event.target, event.detail.required);
      },
      bgColor: (event: CustomEvent) => {
        setColor("bgColor", "backgroundColor", event);
      },
      fillColor: (event: CustomEvent) => {
        setColor("fillColor", "backgroundColor", event);
      },
      fgColor: (event: CustomEvent) => {
        setColor("fgColor", "color", event);
      },
      textColor: (event: CustomEvent) => {
        setColor("textColor", "color", event);
      },
      borderColor: (event: CustomEvent) => {
        setColor("borderColor", "borderColor", event);
      },
      strokeColor: (event: CustomEvent) => {
        setColor("strokeColor", "borderColor", event);
      },
      rotation: (event: CustomEvent) => {
        const angle = event.detail.rotation;
        this.setRotation(angle);
        this.annotationStorage.setValue(this.data.id, {
          rotation: angle,
        });
      },
    });
  }

  _dispatchEventFromSandbox(actions: Record<string, (evt: CustomEvent) => void>, jsEvent: CustomEvent<object>) {
    const commonActions = <Record<string, (evt: CustomEvent) => void>>this._commonActions;
    for (const name of Object.keys(jsEvent.detail)) {
      const action = actions[name] || commonActions[name];
      action?.(jsEvent);
    }
  }

  _setDefaultPropertiesFromJS(element: HTMLElement) {
    if (!this.enableScripting) {
      return;
    }

    // Some properties may have been updated thanks to JS.
    const storedData = this.annotationStorage.getRawValue(this.data.id);
    if (!storedData) {
      return;
    }

    const commonActions = <Record<string, (evt: CustomEvent) => void>>this._commonActions;
    for (const [actionName, detail] of Object.entries(storedData)) {
      const action = commonActions[actionName];
      if (action) {
        // 非常不好的写法，但是为了绕开它的代码，先只能这么做了。
        // 后面应该考虑要改掉
        const eventProxy: unknown = {
          detail: {
            [actionName]: detail,
          },
          target: element,
        };
        action(<CustomEvent>eventProxy);
        // The action has been consumed: no need to keep it.
        delete storedData[actionName];
      }
    }
  }

  /**
   * Create quadrilaterals from the annotation's quadpoints.
   *
   * @private
   * @memberof AnnotationElement
   */
  _createQuadrilaterals() {
    if (!this.container) {
      return;
    }
    const { quadPoints } = this.data;
    if (!quadPoints) {
      return;
    }

    const [rectBlX, rectBlY, rectTrX, rectTrY] = this.data.rect!.map(x =>
      Math.fround(x)
    );

    if (quadPoints.length === 8) {
      const [trX, trY, blX, blY] = quadPoints.subarray(2, 6);
      if (
        rectTrX === trX &&
        rectTrY === trY &&
        rectBlX === blX &&
        rectBlY === blY
      ) {
        // The quadpoints cover the whole annotation rectangle, so no need to
        // create a quadrilateral.
        return;
      }
    }

    const { style } = this.container;
    let svgBuffer: string[] = [];
    if (this._hasBorder) {
      const { borderColor, borderWidth } = style;
      style.borderWidth = "0";
      svgBuffer = [
        "url('data:image/svg+xml;utf8,",
        `<svg xmlns="http://www.w3.org/2000/svg"`,
        ` preserveAspectRatio="none" viewBox="0 0 1 1">`,
        `<g fill="transparent" stroke="${borderColor}" stroke-width="${borderWidth}">`,
      ];
      this.container.classList.add("hasBorder");
    }

    const width = rectTrX - rectBlX;
    const height = rectTrY - rectBlY;

    const { svgFactory } = this;
    const svg = svgFactory.createElement("svg");
    svg.classList.add("quadrilateralsContainer");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    const defs = svgFactory.createElement("defs");
    svg.append(defs);
    const clipPath = svgFactory.createElement("clipPath");
    const id = `clippath_${this.data.id}`;
    clipPath.setAttribute("id", id);
    clipPath.setAttribute("clipPathUnits", "objectBoundingBox");
    defs.append(clipPath);

    for (let i = 2, ii = quadPoints.length; i < ii; i += 8) {
      const trX = quadPoints[i];
      const trY = quadPoints[i + 1];
      const blX = quadPoints[i + 2];
      const blY = quadPoints[i + 3];
      const rect = svgFactory.createElement("rect");
      const x = (blX - rectBlX) / width;
      const y = (rectTrY - trY) / height;
      const rectWidth = (trX - blX) / width;
      const rectHeight = (trY - blY) / height;
      rect.setAttribute("x", x.toString());
      rect.setAttribute("y", y.toString());
      rect.setAttribute("width", rectWidth.toString());
      rect.setAttribute("height", rectHeight.toString());
      clipPath.append(rect);
      svgBuffer?.push(
        `<rect vector-effect="non-scaling-stroke" x="${x}" y="${y}" width="${rectWidth}" height="${rectHeight}"/>`
      );
    }

    if (this._hasBorder) {
      svgBuffer.push(`</g></svg>')`);
      style.backgroundImage = svgBuffer.join("");
    }

    this.container.append(svg);
    this.container.style.clipPath = `url(#${id})`;
  }

  /**
   * Create a popup for the annotation's HTML element. This is used for
   * annotations that do not have a Popup entry in the dictionary, but
   * are of a type that works with popups (such as Highlight annotations).
   *
   * @private
   * @memberof AnnotationElement
   */
  _createPopup() {
    const { data } = this;

    const popup = (this._popupElement = new PopupAnnotationElement({
      data: {
        color: data.color,
        titleObj: data.titleObj,
        modificationDate: data.modificationDate,
        contentsObj: data.contentsObj,
        richText: data.richText,
        parentRect: data.rect!,
        borderStyle: new AnnotationBorderStyle().noBorder(),
        id: `popup_${data.id}`,
        rotation: data.rotation,
      },
      parent: this.parent,
      elements: [this],
    }));
    this.parent.div.append(popup.render());
  }

  /**
   * Render the annotation's HTML element(s).
   *
   * @public
   * @memberof AnnotationElement
   */
  render(): HTMLElement {
    unreachable("Abstract method `AnnotationElement.render` called");
  }

  /**
   * @private
   * @returns {Array}
   */
  _getElementsByName(name: string, skipId: string | null = null) {
    const fields = [];

    if (this._fieldObjects) {
      const fieldObj = this._fieldObjects[name];
      if (fieldObj) {
        for (const { page, id, exportValues } of fieldObj) {
          if (page === -1) {
            continue;
          }
          if (id === skipId) {
            continue;
          }
          const exportValue = typeof exportValues === "string" ? exportValues : null;

          const domElement = document.querySelector(
            `[data-element-id="${id}"]`
          );
          if (domElement && !GetElementsByNameSet.has(domElement)) {
            warn(`_getElementsByName - element not allowed: ${id}`);
            continue;
          }
          fields.push({ id, exportValue, domElement });
        }
      }
      return fields;
    }
    // Fallback to a regular DOM lookup, to ensure that the standalone
    // viewer components won't break.
    for (const domElement of document.getElementsByName(name)) {
      const { exportValue } = <HTMLInputElement>domElement;
      const id = domElement.getAttribute("data-element-id");
      if (id === skipId) {
        continue;
      }
      if (!GetElementsByNameSet.has(domElement)) {
        continue;
      }
      fields.push({ id, exportValue, domElement });
    }
    return fields;
  }

  show() {
    if (this.container) {
      this.container.hidden = false;
    }
    this.popup?.maybeShow();
  }

  hide() {
    if (this.container) {
      this.container.hidden = true;
    }
    this.popup?.forceHide();
  }

  /**
   * Get the HTML element(s) which can trigger a popup when clicked or hovered.
   *
   * @returns  An array of elements or an element.
   */
  getElementsToTriggerPopup(): HTMLElement | HTMLElement[] | SVGElement | SVGElement[] {
    return this.container!;
  }

  addHighlightArea() {
    const triggers = this.getElementsToTriggerPopup()!;
    if (Array.isArray(triggers)) {
      for (const element of triggers) {
        element.classList.add("highlightArea");
      }
    } else {
      triggers.classList.add("highlightArea");
    }
  }

  _editOnDoubleClick() {
    if (!this._isEditable) {
      return;
    }
    const {
      annotationEditorType: mode,
      data: { id: editId },
    } = this;
    this.container!.addEventListener("dblclick", () => {
      this.linkService.eventBus?.dispatch("switchannotationeditormode", {
        source: this,
        mode,
        editId,
      });
    });
  }

  _setRequired(_element: HTMLElement, _isRequired: boolean) { }
}


class LinkAnnotationElement<T extends LinkData> extends AnnotationElement<T> {

  protected isTooltipOnly: boolean;

  constructor(parameters: AnnotationElementParameters<T>, ignoreBorder = false) {
    super(parameters, true, ignoreBorder, true);
    this.isTooltipOnly = parameters.data.isTooltipOnly;
  }

  render() {
    const { data, linkService } = this;
    const link = document.createElement("a");
    link.setAttribute("data-element-id", data.id);
    let isBound = false;

    if (data.url) {
      linkService.addLinkAttributes(link, data.url, data.newWindow);
      isBound = true;
    } else if (data.action) {
      this._bindNamedAction(link, data.action);
      isBound = true;
    } else if (data.attachment) {
      this.#bindAttachment(link, data.attachment, data.attachmentDest);
      isBound = true;
    } else if (data.setOCGState) {
      this.#bindSetOCGState(link, data.setOCGState);
      isBound = true;
    } else if (data.dest) {
      this._bindLink(link, <string>data.dest);
      isBound = true;
    } else {
      if (data.actions
        && (data.actions.has("Action") || data.actions.get("Mouse Up") || data.actions.get("Mouse Down"))
        && this.enableScripting && this.hasJSActions) {
        this._bindJSAction(link, data);
        isBound = true;
      }

      if (data.resetForm) {
        this._bindResetFormAction(link, data.resetForm);
        isBound = true;
      } else if (this.isTooltipOnly && !isBound) {
        this._bindLink(link, "");
        isBound = true;
      }
    }

    this.container!.classList.add("linkAnnotation");
    if (isBound) {
      this.container!.append(link);
    }

    return this.container!;
  }

  #setInternalLink() {
    this.container!.setAttribute("data-internal-link", "");
  }

  /**
   * Bind internal links to the link element.
   *
   * @private
   * @param {Object} link
   * @param {Object} destination
   * @memberof LinkAnnotationElement
   */
  _bindLink(link: HTMLAnchorElement, destination: string) {
    link.href = this.linkService.getDestinationHash(destination);
    link.onclick = () => {
      if (destination) {
        this.linkService.goToDestination(destination);
      }
      return false;
    };
    if (destination || destination === "") {
      this.#setInternalLink();
    }
  }

  /**
   * Bind named actions to the link element.
   *
   * @private
   * @param {Object} link
   * @param {Object} action
   * @memberof LinkAnnotationElement
   */
  _bindNamedAction(link: HTMLAnchorElement, action: string) {
    link.href = this.linkService.getAnchorUrl("");
    link.onclick = () => {
      this.linkService.executeNamedAction(action);
      return false;
    };
    this.#setInternalLink();
  }

  /**
   * Bind attachments to the link element.
   * @param link
   * @param attachment
   * @param [dest]
   */
  #bindAttachment(
    link: HTMLAnchorElement,
    attachment: {
      content: string;
      filename: string;
      description: string;
    },
    dest: string | null = null
  ) {
    link.href = this.linkService.getAnchorUrl("");
    if (attachment.description) {
      link.title = attachment.description;
    }
    link.onclick = () => {
      this.downloadManager?.openOrDownloadData(
        attachment.content,
        attachment.filename,
        dest
      );
      return false;
    };
    this.#setInternalLink();
  }

  /**
   * Bind SetOCGState actions to the link element.
   * @param {Object} link
   * @param {Object} action
   */
  #bindSetOCGState(
    link: HTMLAnchorElement,
    action: {
      state: string[],
      preserveRB: boolean;
    }
  ) {
    link.href = this.linkService.getAnchorUrl("");
    link.onclick = () => {
      this.linkService.executeSetOCGState(action);
      return false;
    };
    this.#setInternalLink();
  }

  /**
   * Bind JS actions to the link element.
   *
   * @private
   * @param {Object} link
   * @param {Object} data
   * @memberof LinkAnnotationElement
   */
  _bindJSAction(link: HTMLAnchorElement, data: LinkData) {
    link.href = this.linkService.getAnchorUrl("");
    const map = new Map<string, keyof HTMLAnchorElement>([
      ["Action", "onclick"],
      ["Mouse Up", "onmouseup"],
      ["Mouse Down", "onmousedown"],
    ]);
    for (const name of data.actions.keys()) {
      const jsName = map.get(name);
      if (!jsName) {
        continue;
      }
      // 这里由link.onclick的这种方式，改造成了addEventListener的形式
      link.addEventListener(jsName, () => {
        this.linkService.eventBus?.dispatch("dispatcheventinsandbox", {
          source: this,
          detail: {
            id: data.id,
            name,
          },
        });
        return false;
      });
    }

    if (!link.onclick) {
      link.onclick = () => false;
    }
    this.#setInternalLink();
  }

  _bindResetFormAction(
    link: HTMLAnchorElement,
    resetForm: {
      fields: string[];
      refs: string[];
      include: boolean;
    }
  ) {
    const otherClickAction: Function | null = link.onclick;
    if (!otherClickAction) {
      link.href = this.linkService.getAnchorUrl("");
    }
    this.#setInternalLink();

    if (!this._fieldObjects) {
      warn(
        `_bindResetFormAction - "resetForm" action not supported, ` +
        "ensure that the `fieldObjects` parameter is provided."
      );
      if (!otherClickAction) {
        link.onclick = () => false;
      }
      return;
    }

    link.onclick = () => {
      // 这种写法也真的是一言难尽
      otherClickAction?.();

      const {
        fields: resetFormFields,
        refs: resetFormRefs,
        include,
      } = resetForm;

      const allFields = [];
      if (resetFormFields.length !== 0 || resetFormRefs.length !== 0) {
        const fieldIds = new Set(resetFormRefs);
        for (const fieldName of resetFormFields) {
          const fields = this._fieldObjects[fieldName] || [];
          for (const { id } of fields) {
            fieldIds.add(id);
          }
        }
        for (const fields of Object.values(this._fieldObjects)) {
          for (const field of fields) {
            if (fieldIds.has(field.id) === include) {
              allFields.push(field);
            }
          }
        }
      } else {
        for (const fields of Object.values(this._fieldObjects)) {
          allFields.push(...fields);
        }
      }

      const storage = this.annotationStorage;
      const allIds = [];
      for (const field of allFields) {
        const { id } = field;
        allIds.push(id);
        switch (field.type) {
          case "text": {
            const value = field.defaultValue || "";
            storage.setValue(id, { value });
            break;
          }
          case "checkbox":
          case "radiobutton": {
            const value = field.defaultValue === field.exportValues;
            storage.setValue(id, { value });
            break;
          }
          case "combobox":
          case "listbox": {
            const value = field.defaultValue || "";
            storage.setValue(id, { value });
            break;
          }
          default:
            continue;
        }

        const domElement = document.querySelector(`[data-element-id="${id}"]`);
        if (!domElement) {
          continue;
        } else if (!GetElementsByNameSet.has(domElement)) {
          warn(`_bindResetFormAction - element not allowed: ${id}`);
          continue;
        }
        domElement.dispatchEvent(new Event("resetform"));
      }

      if (this.enableScripting) {
        // Update the values in the sandbox.
        this.linkService.eventBus?.dispatch("dispatcheventinsandbox", {
          source: this,
          detail: {
            id: "app",
            ids: allIds,
            name: "ResetForm",
          },
        });
      }

      return false;
    };
  }
}

class TextAnnotationElement extends AnnotationElement<TextData> {

  constructor(parameters: AnnotationElementParameters<TextData>) {
    super(parameters, true);
  }

  render() {
    this.container!.classList.add("textAnnotation");

    const image = document.createElement("img");
    image.src = this.imageResourcesPath + "annotation-" +
      this.data.name.toLowerCase() + ".svg";
    image.setAttribute("data-l10n-id", "pdfjs-text-annotation-type");
    image.setAttribute("data-l10n-args", JSON.stringify({ type: this.data.name }));

    if (!this.data.popupRef && this.hasPopupData) {
      this._createPopup();
    }

    this.container!.append(image);
    return this.container!;
  }
}

class WidgetAnnotationElement<T extends WidgetData> extends AnnotationElement<T> {

  constructor(
    parameters: AnnotationElementParameters<T>,
    isRenderable = false,
    ignoreBorder = false,
    createQuadrilaterals = false
  ) {
    super(parameters, isRenderable, ignoreBorder, createQuadrilaterals);
  }

  render() {
    // Show only the container for unsupported field types.
    return this.container!;
  }

  showElementAndHideCanvas(element: HTMLElement) {
    if (this.data.hasOwnCanvas) {
      if (element.previousSibling?.nodeName === "CANVAS") {
        (<HTMLElement>element.previousSibling).hidden = true;
      }
      element.hidden = false;
    }
  }

  _getKeyModifier(event: KeyboardEvent) {
    return FeatureTest.platform.isMac ? event.metaKey : event.ctrlKey;
  }

  _setEventListener(
    element: HTMLElement,
    elementData: { focused: boolean },
    baseName: string,
    eventName: string,
    valueGetter: ((evt: CustomEvent) => string | boolean) | null
  ) {
    if (baseName.includes("mouse")) {
      // Mouse events
      element.addEventListener(baseName, event => {
        this.linkService.eventBus?.dispatch("dispatcheventinsandbox", {
          source: this,
          detail: {
            id: this.data.id,
            name: eventName,
            value: valueGetter!(<CustomEvent>event),
            shift: (<KeyboardEvent>event).shiftKey,
            modifier: this._getKeyModifier(<KeyboardEvent>event),
          },
        });
      });
    } else {
      // Non-mouse events
      element.addEventListener(baseName, event => {
        if (baseName === "blur") {
          if (!elementData.focused || !(<FocusEvent>event).relatedTarget) {
            return;
          }
          elementData.focused = false;
        } else if (baseName === "focus") {
          if (elementData.focused) {
            return;
          }
          elementData.focused = true;
        }

        if (!valueGetter) {
          return;
        }

        this.linkService.eventBus?.dispatch("dispatcheventinsandbox", {
          source: this,
          detail: {
            id: this.data.id,
            name: eventName,
            value: valueGetter(<CustomEvent>event),
          },
        });
      });
    }
  }

  _setEventListeners(
    element: HTMLElement,
    elementData: { focused: boolean } | null,
    names: [string, string][],
    getter: (evt: CustomEvent) => string | boolean
  ) {
    for (const [baseName, eventName] of names) {
      if (eventName === "Action" || this.data.actions?.has(eventName)) {
        if (eventName === "Focus" || eventName === "Blur") {
          elementData ||= { focused: false };
        }
        this._setEventListener(
          element,
          elementData!,
          baseName,
          eventName,
          getter
        );
        if (eventName === "Focus" && !this.data.actions?.has("Blur")) {
          // Ensure that elementData will have the correct value.
          this._setEventListener(element, elementData!, "blur", "Blur", null);
        } else if (eventName === "Blur" && !this.data.actions?.has("Focus")) {
          this._setEventListener(element, elementData!, "focus", "Focus", null);
        }
      }
    }
  }

  _setBackgroundColor(element: HTMLElement) {
    const color = this.data.backgroundColor || null;
    element.style.backgroundColor = color === null ? "transparent"
      : Util.makeHexColor(color[0], color[1], color[2]);
  }

  /**
   * Apply text styles to the text in the element.
   *
   * @private
   * @param {HTMLDivElement} element
   * @memberof TextWidgetAnnotationElement
   */
  _setTextStyle(element: HTMLElement) {
    const TEXT_ALIGNMENT = ["left", "center", "right"];
    const { fontColor } = this.data.defaultAppearanceData!;
    const fontSize = this.data.defaultAppearanceData!.fontSize || DEFAULT_FONT_SIZE;

    const style = element.style;

    // TODO: If the font-size is zero, calculate it based on the height and
    //       width of the element.
    // Not setting `style.fontSize` will use the default font-size for now.

    // We don't use the font, as specified in the PDF document, for the <input>
    // element. Hence using the original `fontSize` could look bad, which is why
    // it's instead based on the field height.
    // If the height is "big" then it could lead to a too big font size
    // so in this case use the one we've in the pdf (hence the min).
    let computedFontSize;
    const BORDER_SIZE = 2;
    const roundToOneDecimal = (x: number) => Math.round(10 * x) / 10;
    if (this.data.multiLine) {
      const height = Math.abs(
        this.data.rect![3] - this.data.rect![1] - BORDER_SIZE
      );
      const numberOfLines = Math.round(height / (LINE_FACTOR * fontSize)) || 1;
      const lineHeight = height / numberOfLines;
      computedFontSize = Math.min(
        fontSize, roundToOneDecimal(lineHeight / LINE_FACTOR)
      );
    } else {
      const height = Math.abs(
        this.data.rect![3] - this.data.rect![1] - BORDER_SIZE
      );
      computedFontSize = Math.min(
        fontSize, roundToOneDecimal(height / LINE_FACTOR)
      );
    }
    style.fontSize = `calc(${computedFontSize}px * var(--scale-factor))`;

    style.color = Util.makeHexColor(fontColor[0], fontColor[1], fontColor[2]);

    if (this.data.textAlignment !== null) {
      style.textAlign = TEXT_ALIGNMENT[this.data.textAlignment];
    }
  }

  _setRequired(element: HTMLElement, isRequired: boolean) {
    if (isRequired) {
      element.setAttribute("required", "true");
    } else {
      element.removeAttribute("required");
    }
    element.setAttribute("aria-required", isRequired ? "true" : "false");
  }
}

interface ElementData {
  userValue: string;
  formattedValue: string | null;
  lastCommittedValue: string | null;
  commitKey: number;
  focused: boolean;
}

class TextWidgetAnnotationElement extends WidgetAnnotationElement<TextData> {
  constructor(parameters: AnnotationElementParameters<TextData>) {
    const isRenderable = parameters.renderForms || parameters.data.hasOwnCanvas ||
      (!parameters.data.hasAppearance && !!parameters.data.fieldValue);
    super(parameters, isRenderable);
  }

  setPropertyOnSiblings(
    base: HTMLTextAreaElement | HTMLInputElement,
    key: "value" /*不是很好解决的蛋疼问题，先这么做着吧 */,
    value: string,
    keyInStorage: string
  ) {
    const storage = this.annotationStorage;
    for (const element of this._getElementsByName(base.name, base.id)) {
      if (element.domElement) {
        (<HTMLTextAreaElement | HTMLInputElement>element.domElement)[key] = value;
      }
      storage.setValue(element.id, { [keyInStorage]: value });
    }
  }

  render() {
    const storage = this.annotationStorage;
    const id = this.data.id;

    this.container!.classList.add("textWidgetAnnotation");

    let element: HTMLInputElement | HTMLTextAreaElement | HTMLDivElement | null = null;
    if (this.renderForms) {
      // NOTE: We cannot set the values using `element.value` below, since it
      //       prevents the AnnotationLayer rasterizer in `test/driver.js`
      //       from parsing the elements correctly for the reference tests.
      const storedData = storage.getValue(id, {
        value: this.data.fieldValue,
      });
      let textContent: string = storedData.value || "";
      const maxLen = storage.getValue(id, {
        charLimit: this.data.maxLen,
      }).charLimit;
      if (maxLen && textContent.length > maxLen) {
        textContent = textContent.slice(0, maxLen);
      }

      let fieldFormattedValues: string | null = storedData.formattedValue
        || this.data.textContent?.join("\n") || null;
      if (fieldFormattedValues && this.data.comb) {
        fieldFormattedValues = fieldFormattedValues.replaceAll(/\s+/g, "");
      }

      const elementData: ElementData = {
        userValue: textContent,
        formattedValue: fieldFormattedValues,
        lastCommittedValue: <string | null>null,
        commitKey: 1,
        focused: false,
      };

      if (this.data.multiLine) {
        element = document.createElement("textarea");
        element.textContent = fieldFormattedValues ?? textContent;
        if (this.data.doNotScroll) {
          element.style.overflowY = "hidden";
        }
      } else {
        element = document.createElement("input");
        (<HTMLInputElement>element).type = "text";
        element.setAttribute("value", fieldFormattedValues ?? textContent);
        if (this.data.doNotScroll) {
          element.style.overflowX = "hidden";
        }
      }
      if (this.data.hasOwnCanvas) {
        element.hidden = true;
      }
      GetElementsByNameSet.add(element);
      element.setAttribute("data-element-id", id);

      (<HTMLInputElement | HTMLTextAreaElement>element).disabled = this.data.readOnly;
      element.name = <string>this.data.fieldName;
      element.tabIndex = DEFAULT_TAB_INDEX;

      this._setRequired(element, this.data.required);

      if (maxLen) {
        (<HTMLInputElement | HTMLTextAreaElement>element).maxLength = maxLen;
      }

      element.addEventListener("input", event => {
        storage.setValue(id, { value: (<HTMLInputElement>event.target).value });
        this.setPropertyOnSiblings(
          <HTMLInputElement | HTMLTextAreaElement>element!,
          "value",
          (<HTMLInputElement>event.target).value,
          "value"
        );
        elementData.formattedValue = null;
      });

      element.addEventListener("resetform", _event => {
        const defaultValue = this.data.defaultFieldValue ?? "";
        (<HTMLInputElement | HTMLTextAreaElement>element)!.value = elementData.userValue = <string>defaultValue;
        elementData.formattedValue = null;
      });

      let blurListener: Function | null = (event: FocusEvent) => {
        const { formattedValue } = elementData;
        if (formattedValue !== null && formattedValue !== undefined) {
          (<HTMLInputElement>event.target).value = formattedValue;
        }
        // Reset the cursor position to the start of the field (issue 12359).
        (<HTMLInputElement>event.target).scrollLeft = 0;
      };

      if (this.enableScripting && this.hasJSActions) {
        element.addEventListener("focus", event => {
          if (elementData.focused) {
            return;
          }
          const target = <HTMLInputElement>event.target;
          if (elementData.userValue) {
            target.value = elementData.userValue;
          }
          elementData.lastCommittedValue = target.value;
          elementData.commitKey = 1;
          if (!this.data.actions?.has("Focus")) {
            elementData.focused = true;
          }
        });

        element.addEventListener("updatefromsandbox", jsEvent => {
          this.showElementAndHideCanvas(<HTMLElement>jsEvent.target);
          const actions = {
            value(event: CustomEvent<{ value: string }>) {
              elementData.userValue = event.detail.value ?? "";
              storage.setValue(id, { value: elementData.userValue.toString() });
              (<HTMLInputElement>event.target).value = elementData.userValue;
            },
            formattedValue(event: CustomEvent<{ formattedValue: string }>) {
              const { formattedValue } = event.detail;
              elementData.formattedValue = formattedValue;
              if (
                formattedValue !== null &&
                formattedValue !== undefined &&
                event.target !== document.activeElement
              ) {
                // Input hasn't the focus so display formatted string
                (<HTMLInputElement>event.target).value = formattedValue;
              }
              storage.setValue(id, {
                formattedValue,
              });
            },
            selRange(event: CustomEvent<{ selRange: [number, number] }>) {
              (<HTMLInputElement>event.target).setSelectionRange(...event.detail.selRange);
            },
            charLimit: (event: CustomEvent<{ charLimit: number }>) => {
              const { charLimit } = event.detail;
              const target = <HTMLInputElement>event.target;
              if (charLimit === 0) {
                target.removeAttribute("maxLength");
                return;
              }

              target.setAttribute("maxLength", charLimit.toString());
              let value = elementData.userValue;
              if (!value || value.length <= charLimit) {
                return;
              }
              value = value.slice(0, charLimit);
              target.value = elementData.userValue = value;
              storage.setValue(id, { value });

              this.linkService.eventBus?.dispatch("dispatcheventinsandbox", {
                source: this,
                detail: {
                  id,
                  name: "Keystroke",
                  value,
                  willCommit: true,
                  commitKey: 1,
                  selStart: target.selectionStart,
                  selEnd: target.selectionEnd,
                },
              });
            },
          };
          this._dispatchEventFromSandbox(actions, <CustomEvent>jsEvent);
        });

        // Even if the field hasn't any actions
        // leaving it can still trigger some actions with Calculate
        element.addEventListener("keydown", _event => {
          const event = <KeyboardEvent>_event;
          elementData.commitKey = 1;
          // If the key is one of Escape, Enter then the data are committed.
          // If we've a Tab then data will be committed on blur.
          let commitKey = -1;
          if (event.key === "Escape") {
            commitKey = 0;
          } else if (event.key === "Enter" && !this.data.multiLine) {
            // When we've a multiline field, "Enter" key is a key as the other
            // hence we don't commit the data (Acrobat behaves the same way)
            // (see issue #15627).
            commitKey = 2;
          } else if (event.key === "Tab") {
            elementData.commitKey = 3;
          }
          if (commitKey === -1) {
            return;
          }
          const { value } = <HTMLInputElement>event.target;
          if (elementData.lastCommittedValue === value) {
            return;
          }
          elementData.lastCommittedValue = value;
          // Save the entered value
          elementData.userValue = value;
          this.linkService.eventBus?.dispatch("dispatcheventinsandbox", {
            source: this,
            detail: {
              id,
              name: "Keystroke",
              value,
              willCommit: true,
              commitKey,
              selStart: (<HTMLInputElement>event.target).selectionStart,
              selEnd: (<HTMLInputElement>event.target).selectionEnd,
            },
          });
        });
        const _blurListener = blurListener;
        blurListener = null;
        element.addEventListener("blur", event => {
          if (!elementData.focused || !(<FocusEvent>event).relatedTarget) {
            return;
          }
          if (!this.data.actions?.has("Blur")) {
            elementData.focused = false;
          }
          const { value } = <HTMLInputElement>event.target;
          elementData.userValue = value;
          if (elementData.lastCommittedValue !== value) {
            this.linkService.eventBus?.dispatch("dispatcheventinsandbox", {
              source: this,
              detail: {
                id,
                name: "Keystroke",
                value,
                willCommit: true,
                commitKey: elementData.commitKey,
                selStart: (<HTMLInputElement>event.target).selectionStart,
                selEnd: (<HTMLInputElement>event.target).selectionEnd,
              },
            });
          }
          _blurListener(event);
        });

        if (this.data.actions?.has("Keystroke")) {
          element.addEventListener("beforeinput", event => {
            elementData.lastCommittedValue = null;
            const { data } = <InputEvent>event;
            const target = <HTMLInputElement>event.target;
            const { value, selectionStart, selectionEnd } = target;

            let selStart = selectionStart;
            let selEnd = selectionEnd;

            switch ((<InputEvent>event).inputType) {
              // https://rawgit.com/w3c/input-events/v1/index.html#interface-InputEvent-Attributes
              case "deleteWordBackward": {
                const match = value.substring(0, selectionStart!).match(/\w*[^\w]*$/);
                if (match) {
                  selStart! -= match[0].length;
                }
                break;
              }
              case "deleteWordForward": {
                const match = value.substring(selectionStart!).match(/^[^\w]*\w*/);
                if (match) {
                  selEnd! += match[0].length;
                }
                break;
              }
              case "deleteContentBackward":
                if (selectionStart === selectionEnd) {
                  selStart! -= 1;
                }
                break;
              case "deleteContentForward":
                if (selectionStart === selectionEnd) {
                  selEnd! += 1;
                }
                break;
            }

            // We handle the event ourselves.
            event.preventDefault();
            this.linkService.eventBus?.dispatch("dispatcheventinsandbox", {
              source: this,
              detail: {
                id,
                name: "Keystroke",
                value,
                change: data || "",
                willCommit: false,
                selStart,
                selEnd,
              },
            });
          });
        }

        this._setEventListeners(
          element,
          elementData,
          [
            ["focus", "Focus"],
            ["blur", "Blur"],
            ["mousedown", "Mouse Down"],
            ["mouseenter", "Mouse Enter"],
            ["mouseleave", "Mouse Exit"],
            ["mouseup", "Mouse Up"],
          ],
          event => (<HTMLInputElement>event.target).value
        );
      }

      if (blurListener) {
        element.addEventListener("blur", <(e: Event) => void>blurListener);
      }

      if (this.data.comb) {
        const fieldWidth = this.data.rect![2] - this.data.rect![0];
        const combWidth = fieldWidth / maxLen;

        element.classList.add("comb");
        element.style.letterSpacing = `calc(${combWidth}px * var(--scale-factor) - 1ch)`;
      }
    } else {
      element = document.createElement("div");
      element.textContent = <string | null>this.data.fieldValue;
      element.style.verticalAlign = "middle";
      element.style.display = "table-cell";

      if (this.data.hasOwnCanvas) {
        element.hidden = true;
      }
    }

    this._setTextStyle(element);
    this._setBackgroundColor(element);
    this._setDefaultPropertiesFromJS(element);

    this.container!.append(element);
    return this.container!;
  }
}

class SignatureWidgetAnnotationElement extends WidgetAnnotationElement<ButtonWidgetData> {
  constructor(parameters: AnnotationElementParameters<ButtonWidgetData>) {
    super(parameters, !!parameters.data.hasOwnCanvas);
  }
}

class CheckboxWidgetAnnotationElement extends WidgetAnnotationElement<ButtonWidgetData> {
  constructor(parameters: AnnotationElementParameters<ButtonWidgetData>) {
    super(parameters, parameters.renderForms);
  }

  render() {
    const storage = this.annotationStorage;
    const data = this.data;
    const id = data.id;
    let value = storage.getValue(id, {
      value: data.exportValue === data.fieldValue,
    }).value;
    if (typeof value === "string") {
      // The value has been changed through js and set in annotationStorage.
      value = value !== "Off";
      storage.setValue(id, { value });
    }

    this.container!.classList.add("buttonWidgetAnnotation", "checkBox");

    const element = document.createElement("input");
    GetElementsByNameSet.add(element);
    element.setAttribute("data-element-id", id);

    element.disabled = data.readOnly;
    this._setRequired(element, this.data.required);
    element.type = "checkbox";
    element.name = data.fieldName!;
    if (value) {
      element.setAttribute("checked", "true");
    }
    element.setAttribute("exportValue", data.exportValue!);
    element.tabIndex = DEFAULT_TAB_INDEX;

    element.addEventListener("change", event => {
      const { name, checked } = <HTMLInputElement>event.target!;
      for (const checkbox of this._getElementsByName(name, id)) {
        const curChecked = checked && checkbox.exportValue === data.exportValue;
        if (checkbox.domElement) {
          (<HTMLInputElement>checkbox.domElement).checked = curChecked;
        }
        storage.setValue(checkbox.id, { value: curChecked });
      }
      storage.setValue(id, { value: checked });
    });

    element.addEventListener("resetform", event => {
      const defaultValue = data.defaultFieldValue || "Off";
      (<HTMLInputElement>event.target).checked = defaultValue === data.exportValue;
    });

    if (this.enableScripting && this.hasJSActions) {
      element.addEventListener("updatefromsandbox", jsEvent => {
        const actions = {
          value(event: CustomEvent<{ value: string }>) {
            (<HTMLInputElement>event.target).checked = event.detail.value !== "Off";
            storage.setValue(id, { value: (<HTMLInputElement>event.target).checked });
          },
        };
        this._dispatchEventFromSandbox(actions, <CustomEvent>jsEvent);
      });

      this._setEventListeners(
        element,
        null,
        [
          ["change", "Validate"],
          ["change", "Action"],
          ["focus", "Focus"],
          ["blur", "Blur"],
          ["mousedown", "Mouse Down"],
          ["mouseenter", "Mouse Enter"],
          ["mouseleave", "Mouse Exit"],
          ["mouseup", "Mouse Up"],
        ],
        (event: CustomEvent<unknown>) => (<HTMLInputElement>event.target).checked
      );
    }

    this._setBackgroundColor(element);
    this._setDefaultPropertiesFromJS(element);

    this.container!.append(element);
    return this.container!;
  }
}

class RadioButtonWidgetAnnotationElement extends WidgetAnnotationElement<ButtonWidgetData> {

  constructor(parameters: AnnotationElementParameters<ButtonWidgetData>) {
    super(parameters, parameters.renderForms);
  }

  render() {
    this.container!.classList.add("buttonWidgetAnnotation", "radioButton");
    const storage = this.annotationStorage;
    const data = this.data;
    const id = data.id;
    let value = storage.getValue(id, {
      value: data.fieldValue === data.buttonValue,
    }).value;
    if (typeof value === "string") {
      // The value has been changed through js and set in annotationStorage.
      value = value !== data.buttonValue;
      storage.setValue(id, { value });
    }

    if (value) {
      // It's possible that multiple radio buttons are checked.
      // So if this one is checked we just reset the other ones.
      // (see bug 1864136). Then when the other ones will be rendered they will
      // unchecked (because of their value in the storage).
      // Consequently, the first checked radio button will be the only checked
      // one.
      for (const radio of this._getElementsByName(data.fieldName!, id)) {
        storage.setValue(radio.id, { value: false });
      }
    }

    const element = document.createElement("input");
    GetElementsByNameSet.add(element);
    element.setAttribute("data-element-id", id);

    element.disabled = data.readOnly;
    this._setRequired(element, this.data.required);
    element.type = "radio";
    element.name = data.fieldName!;
    if (value) {
      element.setAttribute("checked", "true");
    }
    element.tabIndex = DEFAULT_TAB_INDEX;

    element.addEventListener("change", event => {
      const { name, checked } = <HTMLInputElement>event.target;
      for (const radio of this._getElementsByName(name, /* skipId = */ id)) {
        storage.setValue(radio.id, { value: false });
      }
      storage.setValue(id, { value: checked });
    });

    element.addEventListener("resetform", event => {
      const defaultValue = data.defaultFieldValue;
      (<HTMLInputElement>event.target).checked = defaultValue !== null &&
        defaultValue !== undefined &&
        defaultValue === data.buttonValue;
    });

    if (this.enableScripting && this.hasJSActions) {
      const pdfButtonValue = data.buttonValue;
      element.addEventListener("updatefromsandbox", jsEvent => {
        const actions = {
          value: (event: CustomEvent<{ value: string }>) => {
            const checked = pdfButtonValue === event.detail.value;
            for (const radio of this._getElementsByName((<HTMLInputElement>event.target).name)) {
              const curChecked = checked && radio.id === id;
              if (radio.domElement) {
                (<HTMLInputElement>radio.domElement).checked = curChecked;
              }
              storage.setValue(radio.id, { value: curChecked });
            }
          },
        };
        this._dispatchEventFromSandbox(actions, <CustomEvent>jsEvent);
      });

      this._setEventListeners(
        element,
        null,
        [
          ["change", "Validate"],
          ["change", "Action"],
          ["focus", "Focus"],
          ["blur", "Blur"],
          ["mousedown", "Mouse Down"],
          ["mouseenter", "Mouse Enter"],
          ["mouseleave", "Mouse Exit"],
          ["mouseup", "Mouse Up"],
        ],
        (event: CustomEvent<unknown>) => (<HTMLInputElement>event.target).checked
      );
    }

    this._setBackgroundColor(element);
    this._setDefaultPropertiesFromJS(element);

    this.container!.append(element);
    return this.container!;
  }
}

class PushButtonWidgetAnnotationElement extends LinkAnnotationElement<ButtonWidgetData> {
  constructor(parameters: AnnotationElementParameters<ButtonWidgetData>) {
    super(parameters, parameters.data.hasAppearance);
  }

  render() {
    // The rendering and functionality of a push button widget annotation is
    // equal to that of a link annotation, but may have more functionality, such
    // as performing actions on form fields (resetting, submitting, et cetera).
    const container = super.render()!;
    container.classList.add("buttonWidgetAnnotation", "pushButton");

    const linkElement = <HTMLElement>container.lastChild;
    if (this.enableScripting && this.hasJSActions && linkElement) {
      this._setDefaultPropertiesFromJS(linkElement);

      linkElement.addEventListener("updatefromsandbox", jsEvent => {
        this._dispatchEventFromSandbox({}, <CustomEvent>jsEvent);
      });
    }

    return container;
  }
}

class ChoiceWidgetAnnotationElement extends WidgetAnnotationElement<ButtonWidgetData> {

  constructor(parameters: AnnotationElementParameters<ButtonWidgetData>) {
    super(parameters, parameters.renderForms);
  }

  render() {
    this.container!.classList.add("choiceWidgetAnnotation");
    const storage = this.annotationStorage;
    const id = this.data.id;

    const storedData = storage.getValue(id, {
      value: this.data.fieldValue,
    });

    const selectElement = document.createElement("select");
    GetElementsByNameSet.add(selectElement);
    selectElement.setAttribute("data-element-id", id);

    selectElement.disabled = this.data.readOnly;
    this._setRequired(selectElement, this.data.required);
    selectElement.name = this.data.fieldName!;
    selectElement.tabIndex = DEFAULT_TAB_INDEX;

    let addAnEmptyEntry = this.data.combo && this.data.options!.length > 0;

    if (!this.data.combo) {
      // List boxes have a size and (optionally) multiple selection.
      selectElement.size = this.data.options!.length;
      if (this.data.multiSelect) {
        selectElement.multiple = true;
      }
    }

    selectElement.addEventListener("resetform", _event => {
      const defaultValue = this.data.defaultFieldValue;
      for (const option of selectElement.options) {
        option.selected = option.value === defaultValue;
      }
    });

    // Insert the options into the choice field.
    for (const option of this.data.options!) {
      const optionElement = document.createElement("option");
      optionElement.textContent = option.displayValue;
      optionElement.value = option.exportValue!;
      if (storedData.value.includes(option.exportValue)) {
        optionElement.setAttribute("selected", "true");
        addAnEmptyEntry = false;
      }
      selectElement.append(optionElement);
    }

    let removeEmptyEntry: (() => void) | null = null;
    if (addAnEmptyEntry) {
      const noneOptionElement = document.createElement("option");
      noneOptionElement.value = " ";
      noneOptionElement.setAttribute("hidden", "true");
      noneOptionElement.setAttribute("selected", "true");
      selectElement.prepend(noneOptionElement);

      removeEmptyEntry = () => {
        noneOptionElement.remove();
        selectElement.removeEventListener("input", removeEmptyEntry!);
        removeEmptyEntry = null;
      };
      selectElement.addEventListener("input", removeEmptyEntry);
    }

    const getValue = (isExport: Boolean) => {
      const name = isExport ? "value" : "textContent";
      const { options, multiple } = selectElement;
      if (!multiple) {
        return options.selectedIndex === -1 ? null
          : options[options.selectedIndex][name];
      }
      return Array.prototype.filter.call(options, option => option.selected)
        .map(option => option[name]);
    };

    let selectedValues = getValue(/* isExport */ false);

    const getItems = (event: CustomEvent<unknown>) => {
      const options = (<HTMLSelectElement>event.target).options;
      return Array.prototype.map.call(options, option => ({
        displayValue: option.textContent,
        exportValue: option.value,
      }));
    };

    if (this.enableScripting && this.hasJSActions) {
      selectElement.addEventListener("updatefromsandbox", jsEvent => {
        const actions = {

          value(event: CustomEvent<{ value: string }>) {
            removeEmptyEntry?.();
            const value = event.detail.value;
            const values = new Set(Array.isArray(value) ? value : [value]);
            for (const option of selectElement.options) {
              option.selected = values.has(option.value);
            }
            storage.setValue(id, {
              value: getValue(/* isExport */ true),
            });
            selectedValues = getValue(/* isExport */ false);
          },

          multipleSelection(_event: CustomEvent<unknown>) {
            selectElement.multiple = true;
          },

          remove(event: CustomEvent<{ remove: number }>) {
            const options = selectElement.options;
            const index = event.detail.remove;
            options[index].selected = false;
            selectElement.remove(index);
            if (options.length > 0) {
              const i = Array.prototype.findIndex.call(
                options,
                option => option.selected
              );
              if (i === -1) {
                options[0].selected = true;
              }
            }
            storage.setValue(id, {
              value: getValue(true),
              items: getItems(event),
            });
            selectedValues = getValue(false);
          },
          clear(_event: CustomEvent<unknown>) {
            while (selectElement.length !== 0) {
              selectElement.remove(0);
            }
            storage.setValue(id, { value: null, items: [] });
            selectedValues = getValue(/* isExport */ false);
          },
          insert(event: CustomEvent<{
            insert: { index: number, displayValue: string, exportValue: string }
          }>) {
            const { index, displayValue, exportValue } = event.detail.insert;
            const selectChild = selectElement.children[index];
            const optionElement = document.createElement("option");
            optionElement.textContent = displayValue;
            optionElement.value = exportValue;

            if (selectChild) {
              selectChild.before(optionElement);
            } else {
              selectElement.append(optionElement);
            }
            storage.setValue(id, {
              value: getValue(true),
              items: getItems(event),
            });
            selectedValues = getValue(false);
          },
          items(event: CustomEvent<{ items: { displayValue: string | null, exportValue: string }[] }>) {
            const { items } = event.detail;
            while (selectElement.length !== 0) {
              selectElement.remove(0);
            }
            for (const item of items) {
              const { displayValue, exportValue } = item;
              const optionElement = document.createElement("option");
              optionElement.textContent = displayValue;
              optionElement.value = exportValue;
              selectElement.append(optionElement);
            }
            if (selectElement.options.length > 0) {
              selectElement.options[0].selected = true;
            }
            storage.setValue(id, {
              value: getValue(/* isExport */ true),
              items: getItems(event),
            });
            selectedValues = getValue(/* isExport */ false);
          },
          indices(event: CustomEvent<{ indices: number[] }>) {
            const indices = new Set(event.detail.indices);
            for (const option of (<HTMLSelectElement>event.target).options) {
              option.selected = indices.has(option.index);
            }
            storage.setValue(id, {
              value: getValue(/* isExport */ true),
            });
            selectedValues = getValue(/* isExport */ false);
          },
          editable(event: CustomEvent<{ editable: boolean }>) {
            (<HTMLInputElement>event.target).disabled = !event.detail.editable;
          },
        };
        this._dispatchEventFromSandbox(actions, <CustomEvent<object>>jsEvent);
      });

      selectElement.addEventListener("input", event => {
        const exportValue = getValue(/* isExport */ true);
        const change = getValue(/* isExport */ false);
        storage.setValue(id, { value: exportValue });

        event.preventDefault();

        this.linkService.eventBus?.dispatch("dispatcheventinsandbox", {
          source: this,
          detail: {
            id,
            name: "Keystroke",
            value: selectedValues,
            change,
            changeEx: exportValue,
            willCommit: false,
            commitKey: 1,
            keyDown: false,
          },
        });
      });

      this._setEventListeners(
        selectElement,
        null,
        [
          ["focus", "Focus"],
          ["blur", "Blur"],
          ["mousedown", "Mouse Down"],
          ["mouseenter", "Mouse Enter"],
          ["mouseleave", "Mouse Exit"],
          ["mouseup", "Mouse Up"],
          ["input", "Action"],
          ["input", "Validate"],
        ],
        (event: CustomEvent) => (<HTMLInputElement>event.target).value
      );
    } else {
      selectElement.addEventListener("input", _event => {
        storage.setValue(id, { value: getValue(true) });
      });
    }

    if (this.data.combo) {
      this._setTextStyle(selectElement);
    } else {
      // Just use the default font size...
      // it's a bit hard to guess what is a good size.
    }
    this._setBackgroundColor(selectElement);
    this._setDefaultPropertiesFromJS(selectElement);

    this.container!.append(selectElement);
    return this.container!;
  }
}

class PopupAnnotationElement extends AnnotationElement<PopupData> {

  public popup: PopupElement | null;

  public elements: AnnotationElement<AnnotationData>[];

  constructor(parameters: AnnotationElementParameters<PopupData>) {
    const { data, elements } = parameters;
    super(parameters, AnnotationElement._hasPopupData(
      data.titleObj, data.contentsObj, data.richText
    ));
    this.elements = elements;
    this.popup = null;
  }

  render() {
    this.container!.classList.add("popupAnnotation");

    const popup = (this.popup = new PopupElement(
      this.container!,
      <RGBType>Array.from(this.data.color!),
      this.elements,
      this.data.titleObj!,
      this.data.modificationDate,
      this.data.contentsObj,
      this.data.richText,
      this.parent,
      this.data.rect,
      this.data.parentRect || null,
      this.data.open,
    ));

    const elementIds = [];
    for (const element of this.elements) {
      element.popup = popup;
      element.container!.ariaHasPopup = "dialog";
      elementIds.push(element.data.id);
      element.addHighlightArea();
    }

    this.container!.setAttribute(
      "aria-controls",
      elementIds.map(id => `${AnnotationPrefix}${id}`).join(",")
    );

    return this.container!;
  }
}

interface PopupLine {
  name: string;
  value: string;
  attributes: {
    style: {
      color: any;
      fontSize: string;
    };
  };
}

interface PopupContent {
  str: string;
  html: {
    name: string;
    attributes: {
      dir: string;
      style: {
        fontSize: number,
        color: string,
      } | null
    };
    children: {
      name: string;
      children: PopupLine[];
    }[];
  };
}


class PopupElement {

  #boundKeyDown = this.#keyDown.bind(this);

  #boundHide = this.#hide.bind(this);

  #boundShow = this.#show.bind(this);

  #boundToggle = this.#toggle.bind(this);

  #color: RGBType | null = null;

  #container: HTMLElement;

  #contentsObj: StringObj | null;

  #dateObj: Date | null = null;

  #elements: AnnotationElement<AnnotationData>[];

  #parent: AnnotationLayer | null = null;

  #parentRect: RectType | null;

  #pinned = false;

  #popup: HTMLDivElement | null = null;

  #position: PointType | null = null;

  #rect: RectType;

  #richText: PopupContent | null = null;

  #titleObj: StringObj;

  #updates: {
    contentsObj: StringObj | null,
    richText: PopupContent | null,
  } | null = null;

  #wasVisible = false;

  protected trigger: HTMLElement[];

  constructor(
    container: HTMLElement,
    color: RGBType,
    elements: AnnotationElement<AnnotationData>[],
    titleObj: StringObj,
    modificationDate: string | null,
    contentsObj: StringObj,
    richText: PopupContent,
    parent: AnnotationLayer,
    rect: RectType,
    parentRect: RectType | null,
    open: boolean,
  ) {
    this.#container = container;
    this.#titleObj = titleObj;
    this.#contentsObj = contentsObj;
    this.#richText = richText;
    this.#parent = parent;
    this.#color = color;
    this.#rect = rect;
    this.#parentRect = parentRect;
    this.#elements = elements;

    // The modification date is shown in the popup instead of the creation
    // date if it is available and can be parsed correctly, which is
    // consistent with other viewers such as Adobe Acrobat.
    this.#dateObj = PDFDateString.toDateObject(modificationDate);

    this.trigger = <HTMLElement[]>elements.flatMap(e => e.getElementsToTriggerPopup());
    // Attach the event listeners to the trigger element.
    for (const element of this.trigger) {
      element.addEventListener("click", this.#boundToggle);
      element.addEventListener("mouseenter", this.#boundShow);
      element.addEventListener("mouseleave", this.#boundHide);
      element.classList.add("popupTriggerArea");
    }

    // Attach the event listener to toggle the popup with the keyboard.
    for (const element of elements) {
      element.container?.addEventListener("keydown", this.#boundKeyDown);
    }

    this.#container.hidden = true;
    if (open) {
      this.#toggle();
    }
  }

  render() {
    if (this.#popup) {
      return;
    }

    const popup = (this.#popup = document.createElement("div"));
    popup.className = "popup";

    if (this.#color) {
      const baseColor = (popup.style.outlineColor = Util.makeHexColor(...this.#color));
      if (
        PlatformHelper.isMozCental() ||
        CSS.supports("background-color", "color-mix(in srgb, red 30%, white)")
      ) {
        popup.style.backgroundColor = `color-mix(in srgb, ${baseColor} 30%, white)`;
      } else {
        // color-mix isn't supported in some browsers hence this version.
        // See https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/color-mix#browser_compatibility
        // TODO: Use color-mix when it's supported everywhere.
        // Enlighten the color.
        const BACKGROUND_ENLIGHT = 0.7;
        popup.style.backgroundColor = Util.makeHexColor(
          ...<RGBType>this.#color.map(c =>
            Math.floor(BACKGROUND_ENLIGHT * (255 - c) + c)
          )
        );
      }
    }

    const header = document.createElement("span");
    header.className = "header";
    const title = document.createElement("h1");
    header.append(title);
    ({ dir: title.dir, str: title.textContent } = this.#titleObj);
    popup.append(header);

    if (this.#dateObj) {
      const modificationDate = document.createElement("span");
      modificationDate.classList.add("popupDate");
      modificationDate.setAttribute(
        "data-l10n-id",
        "pdfjs-annotation-date-time-string"
      );
      modificationDate.setAttribute(
        "data-l10n-args",
        JSON.stringify({ dateObj: this.#dateObj.valueOf() })
      );
      header.append(modificationDate);
    }

    const html = this.#html;
    if (!html) {
      const contents = this._formatContents(
        this.#contentsObj!.dir, this.#contentsObj!.str
      );
      popup.append(contents);
    }
    this.#container.append(popup);
  }

  get #html() {
    const richText = this.#richText;
    const contentsObj = this.#contentsObj;
    if (
      richText?.str &&
      (!contentsObj?.str || contentsObj.str === richText.str)
    ) {
      return this.#richText!.html || null;
    }
    return null;
  }

  get #fontSize() {
    return this.#html?.attributes?.style?.fontSize || 0;
  }

  get #fontColor() {
    return this.#html?.attributes?.style?.color || null;
  }

  #makePopupContent(text: string) {
    const popupLines: PopupLine[] = [];
    const popupContent: PopupContent = {
      str: text,
      html: {
        name: "div",
        attributes: {
          dir: "auto",
          style: null,
        },
        children: [{
          name: "p",
          children: popupLines,
        }],
      },
    };
    const lineAttributes = {
      style: {
        color: this.#fontColor,
        fontSize: this.#fontSize
          ? `calc(${this.#fontSize}px * var(--scale-factor))`
          : "",
      },
    };
    for (const line of text.split("\n")) {
      popupLines.push({
        name: "span",
        value: line,
        attributes: lineAttributes,
      });
    }
    return popupContent;
  }

  /**
   * Format the contents of the popup by adding newlines where necessary.
   *
   * @private
   * @param {Object<string, string>} contentsObj
   * @memberof PopupElement
   * @returns {HTMLParagraphElement}
   */
  _formatContents(str: string, dir: string) {
    const p = document.createElement("p");
    p.classList.add("popupContent");
    p.dir = dir;
    const lines = str.split(/(?:\r\n?|\n)/);
    for (let i = 0, ii = lines.length; i < ii; ++i) {
      const line = lines[i];
      p.append(document.createTextNode(line));
      if (i < ii - 1) {
        p.append(document.createElement("br"));
      }
    }
    return p;
  }

  #keyDown(event: KeyboardEvent) {
    if (event.altKey || event.shiftKey || event.ctrlKey || event.metaKey) {
      return;
    }

    if (event.key === "Enter" || (event.key === "Escape" && this.#pinned)) {
      this.#toggle();
    }
  }

  updateEdited(rect: RectType | null, popupContent: string | null) {
    this.#updates ||= {
      contentsObj: this.#contentsObj,
      richText: this.#richText,
    };
    if (rect) {
      this.#position = null;
    }
    if (popupContent) {
      this.#richText = this.#makePopupContent(popupContent);
      this.#contentsObj = null;
    }
    this.#popup?.remove();
    this.#popup = null;
  }

  resetEdited() {
    if (!this.#updates) {
      return;
    }
    ({ contentsObj: this.#contentsObj, richText: this.#richText } =
      this.#updates);
    this.#updates = null;
    this.#popup?.remove();
    this.#popup = null;
    this.#position = null;
  }

  #setPosition() {
    if (this.#position !== null) {
      return;
    }
    const {
      page: { view },
      viewport: {
        rawDims: { pageWidth, pageHeight, pageX, pageY },
      },
    } = this.#parent!;

    let useParentRect = !!this.#parentRect;
    let rect = useParentRect ? this.#parentRect : this.#rect;
    for (const element of this.#elements) {
      if (!rect || Util.intersect(element.data.rect!, rect) !== null) {
        rect = element.data.rect;
        useParentRect = true;
        break;
      }
    }

    const normalizedRect = Util.normalizeRect([
      rect![0],
      view[3] - rect![1] + view[1],
      rect![2],
      view[3] - rect![3] + view[1],
    ]);

    const HORIZONTAL_SPACE_AFTER_ANNOTATION = 5;
    const parentWidth = useParentRect ? rect![2] - rect![0] + HORIZONTAL_SPACE_AFTER_ANNOTATION : 0;
    const popupLeft = normalizedRect[0] + parentWidth;
    const popupTop = normalizedRect[1];
    this.#position = [
      (100 * (popupLeft - pageX)) / pageWidth,
      (100 * (popupTop - pageY)) / pageHeight,
    ];

    const { style } = this.#container;
    style.left = `${this.#position[0]}%`;
    style.top = `${this.#position[1]}%`;
  }

  /**
   * Toggle the visibility of the popup.
   */
  #toggle() {
    this.#pinned = !this.#pinned;
    if (this.#pinned) {
      this.#show();
      this.#container.addEventListener("click", this.#boundToggle);
      this.#container.addEventListener("keydown", this.#boundKeyDown);
    } else {
      this.#hide();
      this.#container.removeEventListener("click", this.#boundToggle);
      this.#container.removeEventListener("keydown", this.#boundKeyDown);
    }
  }

  /**
   * Show the popup.
   */
  #show() {
    if (!this.#popup) {
      this.render();
    }
    if (!this.isVisible) {
      this.#setPosition();
      this.#container.hidden = false;
      this.#container.style.zIndex = `${parseInt(this.#container.style.zIndex) + 1000}`;
    } else if (this.#pinned) {
      this.#container.classList.add("focused");
    }
  }

  /**
   * Hide the popup.
   */
  #hide() {
    this.#container.classList.remove("focused");
    if (this.#pinned || !this.isVisible) {
      return;
    }
    this.#container.hidden = true;
    this.#container.style.zIndex = `${parseInt(this.#container.style.zIndex) - 1000}`;
  }

  forceHide() {
    this.#wasVisible = this.isVisible;
    if (!this.#wasVisible) {
      return;
    }
    this.#container.hidden = true;
  }

  maybeShow() {
    if (!this.#wasVisible) {
      return;
    }
    if (!this.#popup) {
      this.#show();
    }
    this.#wasVisible = false;
    this.#container.hidden = false;
  }

  get isVisible() {
    return this.#container.hidden === false;
  }
}

export class FreeTextAnnotationElement extends AnnotationElement<FreeTextData> {

  public annotationEditorType: AnnotationEditorType;

  protected textContent: string[];

  protected textPosition: PointType;

  constructor(parameters: AnnotationElementParameters<FreeTextData>) {
    super(parameters, true, true);
    this.textContent = parameters.data.textContent!;
    this.textPosition = <PointType>parameters.data.textPosition;
    this.annotationEditorType = AnnotationEditorType.FREETEXT;
  }

  render() {
    this.container!.classList.add("freeTextAnnotation");
    if (this.textContent) {
      const content = document.createElement("div");
      content.classList.add("annotationTextContent");
      content.setAttribute("role", "comment");
      for (const line of this.textContent) {
        const lineSpan = document.createElement("span");
        lineSpan.textContent = line;
        content.append(lineSpan);
      }
      this.container!.append(content);
    }
    if (!this.data.popupRef && this.hasPopupData) {
      this._createPopup();
    }
    this._editOnDoubleClick();
    return this.container!;
  }
}
class LineAnnotationElement extends AnnotationElement<LineData> {

  #line: SVGElement | null = null;

  constructor(parameters: AnnotationElementParameters<LineData>) {
    super(parameters, true, true);
  }

  render() {
    this.container!.classList.add("lineAnnotation");

    // Create an invisible line with the same starting and ending coordinates
    // that acts as the trigger for the popup. Only the line itself should
    // trigger the popup, not the entire container.
    const data = this.data;
    const { width, height } = getRectDims(data.rect!);
    const svg = this.svgFactory.create(width, height, true);

    // PDF coordinates are calculated from a bottom left origin, so transform
    // the line coordinates to a top left origin for the SVG element.
    const line = (this.#line = this.svgFactory.createElement("svg:line"));
    line.setAttribute("x1", `${data.rect![2] - data.lineCoordinates[0]}`);
    line.setAttribute("y1", `${data.rect![3] - data.lineCoordinates[1]}`);
    line.setAttribute("x2", `${data.rect![2] - data.lineCoordinates[2]}`);
    line.setAttribute("y2", `${data.rect![3] - data.lineCoordinates[3]}`);
    // Ensure that the 'stroke-width' is always non-zero, since otherwise it
    // won't be possible to open/close the popup (note e.g. issue 11122).
    line.setAttribute("stroke-width", `${data.borderStyle.width || 1}`);
    line.setAttribute("stroke", "transparent");
    line.setAttribute("fill", "transparent");

    svg.append(line);
    this.container!.append(svg);

    // Create the popup ourselves so that we can bind it to the line instead
    // of to the entire container (which is the default).
    if (!data.popupRef && this.hasPopupData) {
      this._createPopup();
    }

    return this.container!;
  }

  getElementsToTriggerPopup() {
    return this.#line!;
  }

  addHighlightArea() {
    this.container!.classList.add("highlightArea");
  }
}

class SquareAnnotationElement extends AnnotationElement<SquareData> {

  #square: SVGElement | null = null;

  constructor(parameters: AnnotationElementParameters<SquareData>) {
    super(parameters, true, true);
  }

  render() {
    this.container!.classList.add("squareAnnotation");

    // Create an invisible square with the same rectangle that acts as the
    // trigger for the popup. Only the square itself should trigger the
    // popup, not the entire container.
    const data = this.data;
    const { width, height } = getRectDims(data.rect!);
    const svg = this.svgFactory.create(width, height, true);

    // The browser draws half of the borders inside the square and half of
    // the borders outside the square by default. This behavior cannot be
    // changed programmatically, so correct for that here.
    const borderWidth = data.borderStyle.width;
    const square = (this.#square = this.svgFactory.createElement("svg:rect"));
    square.setAttribute("x", `${borderWidth / 2}`);
    square.setAttribute("y", `${borderWidth / 2}`);
    square.setAttribute("width", `${width - borderWidth}`);
    square.setAttribute("height", `${height - borderWidth}`);
    // Ensure that the 'stroke-width' is always non-zero, since otherwise it
    // won't be possible to open/close the popup (note e.g. issue 11122).
    square.setAttribute("stroke-width", `${borderWidth || 1}`);
    square.setAttribute("stroke", "transparent");
    square.setAttribute("fill", "transparent");

    svg.append(square);
    this.container!.append(svg);

    // Create the popup ourselves so that we can bind it to the square instead
    // of to the entire container (which is the default).
    if (!data.popupRef && this.hasPopupData) {
      this._createPopup();
    }

    return this.container!;
  }

  getElementsToTriggerPopup() {
    return this.#square!;
  }

  addHighlightArea() {
    this.container!.classList.add("highlightArea");
  }
}

class CircleAnnotationElement extends AnnotationElement<CircleData> {

  #circle: SVGElement | null = null;

  constructor(parameters: AnnotationElementParameters<CircleData>) {
    super(parameters, true, true);
  }

  render() {
    this.container!.classList.add("circleAnnotation");

    // Create an invisible circle with the same ellipse that acts as the
    // trigger for the popup. Only the circle itself should trigger the
    // popup, not the entire container.
    const data = this.data;
    const { width, height } = getRectDims(data.rect!);
    const svg = this.svgFactory.create(
      width, height, true
    );

    // The browser draws half of the borders inside the circle and half of
    // the borders outside the circle by default. This behavior cannot be
    // changed programmatically, so correct for that here.
    const borderWidth = data.borderStyle.width;
    const circle = (this.#circle = this.svgFactory.createElement("svg:ellipse"));
    circle.setAttribute("cx", `${width / 2}`);
    circle.setAttribute("cy", `${height / 2}`);
    circle.setAttribute("rx", `${width / 2 - borderWidth / 2}`);
    circle.setAttribute("ry", `${height / 2 - borderWidth / 2}`);
    // Ensure that the 'stroke-width' is always non-zero, since otherwise it
    // won't be possible to open/close the popup (note e.g. issue 11122).
    circle.setAttribute("stroke-width", `${borderWidth || 1}`);
    circle.setAttribute("stroke", "transparent");
    circle.setAttribute("fill", "transparent");

    svg.append(circle);
    this.container!.append(svg);

    // Create the popup ourselves so that we can bind it to the circle instead
    // of to the entire container (which is the default).
    if (!data.popupRef && this.hasPopupData) {
      this._createPopup();
    }

    return this.container!;
  }

  getElementsToTriggerPopup() {
    return this.#circle!;
  }

  addHighlightArea() {
    this.container!.classList.add("highlightArea");
  }
}

class PolylineAnnotationElement extends AnnotationElement<PolylineData> {

  #polyline: SVGElement | null = null;

  protected containerClassName: string;

  protected svgElementName: string;

  constructor(parameters: AnnotationElementParameters<PolylineData>) {
    super(parameters, true, true);

    this.containerClassName = "polylineAnnotation";
    this.svgElementName = "svg:polyline";
  }

  render() {
    this.container!.classList.add(this.containerClassName);

    // Create an invisible polyline with the same points that acts as the
    // trigger for the popup. Only the polyline itself should trigger the
    // popup, not the entire container.
    const {
      data: { rect, vertices, borderStyle, popupRef },
    } = this;
    if (!vertices) {
      return this.container!;
    }
    const { width, height } = getRectDims(rect!);
    const svg = this.svgFactory.create(
      width, height, true
    );

    // Convert the vertices array to a single points string that the SVG
    // polyline element expects ("x1,y1 x2,y2 ..."). PDF coordinates are
    // calculated from a bottom left origin, so transform the polyline
    // coordinates to a top left origin for the SVG element.
    let points = [];
    for (let i = 0, ii = vertices.length; i < ii; i += 2) {
      const x = vertices[i] - rect![0];
      const y = rect![3] - vertices[i + 1];
      points.push(`${x}, ${y}`);
    }
    const pointsStr = points.join(" ");

    const polyline = (this.#polyline = this.svgFactory.createElement(
      this.svgElementName
    ));
    polyline.setAttribute("points", pointsStr);
    // Ensure that the 'stroke-width' is always non-zero, since otherwise it
    // won't be possible to open/close the popup (note e.g. issue 11122).
    polyline.setAttribute("stroke-width", `${borderStyle.width || 1}`);
    polyline.setAttribute("stroke", "transparent");
    polyline.setAttribute("fill", "transparent");

    svg.append(polyline);
    this.container!.append(svg);

    // Create the popup ourselves so that we can bind it to the polyline
    // instead of to the entire container (which is the default).
    if (!popupRef && this.hasPopupData) {
      this._createPopup();
    }

    return this.container!;
  }

  getElementsToTriggerPopup() {
    return this.#polyline!;
  }

  addHighlightArea() {
    this.container!.classList.add("highlightArea");
  }
}

class PolygonAnnotationElement extends PolylineAnnotationElement {

  constructor(parameters: AnnotationElementParameters<PolylineData>) {
    // Polygons are specific forms of polylines, so reuse their logic.
    super(parameters);

    this.containerClassName = "polygonAnnotation";
    this.svgElementName = "svg:polygon";
  }
}

class CaretAnnotationElement extends AnnotationElement<CaretData> {

  constructor(parameters: AnnotationElementParameters<CaretData>) {
    super(parameters, true, true);
  }

  render() {
    this.container!.classList.add("caretAnnotation");

    if (!this.data.popupRef && this.hasPopupData) {
      this._createPopup();
    }
    return this.container!;
  }
}

export class InkAnnotationElement extends AnnotationElement<InkAnnotationData> {

  #polylines: SVGElement[] = [];

  protected containerClassName: string;

  protected svgElementName: string;

  public annotationEditorType: AnnotationEditorType;

  constructor(parameters: AnnotationElementParameters<InkAnnotationData>) {
    super(parameters, true, true);

    this.containerClassName = "inkAnnotation";

    // Use the polyline SVG element since it allows us to use coordinates
    // directly and to draw both straight lines and curves.
    this.svgElementName = "svg:polyline";

    this.annotationEditorType = this.data.it === "InkHighlight"
      ? AnnotationEditorType.HIGHLIGHT : AnnotationEditorType.INK;
  }

  render() {
    this.container!.classList.add(this.containerClassName);

    // Create an invisible polyline with the same points that acts as the
    // trigger for the popup.
    const { data: { rect, inkLists, borderStyle, popupRef } } = this;
    const { width, height } = getRectDims(rect!);
    const svg = this.svgFactory.create(
      width, height, true
    );

    for (const inkList of inkLists) {
      // Convert the ink list to a single points string that the SVG
      // polyline element expects ("x1,y1 x2,y2 ..."). PDF coordinates are
      // calculated from a bottom left origin, so transform the polyline
      // coordinates to a top left origin for the SVG element.
      let points = [];
      for (let i = 0, ii = inkList.length; i < ii; i += 2) {
        const x = inkList[i] - rect![0];
        const y = rect![3] - inkList[i + 1];
        points.push(`${x}, ${y}`);
      }
      const pointsStr = points.join(" ");

      const polyline = this.svgFactory.createElement(this.svgElementName);
      this.#polylines.push(polyline);
      polyline.setAttribute("points", pointsStr);
      // Ensure that the 'stroke-width' is always non-zero, since otherwise it
      // won't be possible to open/close the popup (note e.g. issue 11122).
      polyline.setAttribute("stroke-width", `${borderStyle.width || 1}`);
      polyline.setAttribute("stroke", "transparent");
      polyline.setAttribute("fill", "transparent");

      svg.append(polyline);
    }

    if (!popupRef && this.hasPopupData) {
      this._createPopup();
    }

    this.container!.append(svg);
    this._editOnDoubleClick();

    return this.container!;
  }

  getElementsToTriggerPopup() {
    return this.#polylines!;
  }

  addHighlightArea() {
    this.container!.classList.add("highlightArea");
  }
}

export class HighlightAnnotationElement extends AnnotationElement<HighlightData> {

  public annotationEditorType: AnnotationEditorType;

  constructor(parameters: AnnotationElementParameters<HighlightData>) {
    super(parameters, true, true, true);
    this.annotationEditorType = AnnotationEditorType.HIGHLIGHT;
  }

  render() {
    if (!this.data.popupRef && this.hasPopupData) {
      this._createPopup();
    }
    this.container!.classList.add("highlightAnnotation");
    this._editOnDoubleClick();
    return this.container!;
  }
}

class UnderlineAnnotationElement extends AnnotationElement<UnderlineData> {

  constructor(parameters: AnnotationElementParameters<UnderlineData>) {
    super(parameters, true, true, true);
  }

  render() {
    if (!this.data.popupRef && this.hasPopupData) {
      this._createPopup();
    }

    this.container!.classList.add("underlineAnnotation");
    return this.container!;
  }
}

class SquigglyAnnotationElement extends AnnotationElement<SquigglyData> {

  constructor(parameters: AnnotationElementParameters<SquigglyData>) {
    super(parameters, true, true, true);
  }

  render() {
    if (!this.data.popupRef && this.hasPopupData) {
      this._createPopup();
    }

    this.container!.classList.add("squigglyAnnotation");
    return this.container!;
  }
}

class StrikeOutAnnotationElement extends AnnotationElement<StrikeOutData> {

  constructor(parameters: AnnotationElementParameters<StrikeOutData>) {
    super(parameters, true, true, true);
  }

  render() {
    if (!this.data.popupRef && this.hasPopupData) {
      this._createPopup();
    }

    this.container!.classList.add("strikeoutAnnotation");
    return this.container!;
  }
}

export class StampAnnotationElement extends AnnotationElement<StampData> {

  public annotationEditorType: AnnotationEditorType;

  constructor(parameters: AnnotationElementParameters<StampData>) {
    super(parameters, true, true);
    this.annotationEditorType = AnnotationEditorType.STAMP;
  }

  render() {
    this.container!.classList.add("stampAnnotation");
    this.container!.setAttribute("role", "img");

    if (!this.data.popupRef && this.hasPopupData) {
      this._createPopup();
    }
    this._editOnDoubleClick();

    return this.container!;
  }
}

class FileAttachmentAnnotationElement extends AnnotationElement<FileAttachmentData> {

  #trigger: HTMLElement | null = null;

  protected filename;

  protected content: Uint8Array<ArrayBuffer>;

  constructor(parameters: AnnotationElementParameters<FileAttachmentData>) {
    super(parameters, true);

    const { file } = this.data;
    this.filename = file.filename;
    this.content = file.content!;

    this.linkService.eventBus?.dispatch("fileattachmentannotation", {
      source: this,
      ...file,
    });
  }

  render() {
    this.container!.classList.add("fileAttachmentAnnotation");

    const { container, data } = this;
    let trigger: HTMLElement;
    if (data.hasAppearance || data.fillAlpha === 0) {
      trigger = document.createElement("div");
    } else {
      // Unfortunately it seems that it's not clearly specified exactly what
      // names are actually valid, since Table 184 contains:
      //   Conforming readers shall provide predefined icon appearances for at
      //   least the following standard names: GraphPushPin, PaperclipTag.
      //   Additional names may be supported as well. Default value: PushPin.
      trigger = document.createElement("img");
      (<HTMLImageElement>trigger).src = `${this.imageResourcesPath}annotation` +
        ` - ${/paperclip/i.test(data.name) ? "paperclip" : "pushpin"}.svg`;

      if (data.fillAlpha && data.fillAlpha < 1) {
        // 这边的代码有bug，怎么把值赋给了不该赋值的对象了？
        const styler = <unknown>trigger;
        (<{ style: string }>styler).style = `filter: opacity(${Math.round(data.fillAlpha * 100)} %); `;

        if (PlatformHelper.isTesting()) {
          this.container!.classList.add("hasFillAlpha");
        }
      }
    }
    trigger.addEventListener("dblclick", this.#download.bind(this));
    this.#trigger = trigger;

    const { isMac } = FeatureTest.platform;
    container!.addEventListener("keydown", evt => {
      if (evt.key === "Enter" && (isMac ? evt.metaKey : evt.ctrlKey)) {
        this.#download();
      }
    });

    if (!data.popupRef && this.hasPopupData) {
      this._createPopup();
    } else {
      trigger.classList.add("popupTriggerArea");
    }

    container!.append(trigger);
    return container!;
  }

  getElementsToTriggerPopup() {
    return this.#trigger!;
  }

  addHighlightArea() {
    this.container!.classList.add("highlightArea");
  }

  /**
   * Download the file attachment associated with this annotation.
   */
  #download() {
    this.downloadManager?.openOrDownloadData(this.content, this.filename, null);
  }
}

/**
 * @typedef {Object} AnnotationLayerParameters
 * @property {PageViewport} viewport
 * @property {HTMLDivElement} div
 * @property {Array} annotations
 * @property {PDFPageProxy} page
 * @property {PDFLinkService} linkService
 * @property {DownloadManager} [downloadManager]
 * @property {AnnotationStorage} [annotationStorage]
 * @property {string} [imageResourcesPath] - Path for image resources, mainly
 *   for annotation icons. Include trailing slash.
 * @property {boolean} renderForms
 * @property {boolean} [enableScripting] - Enable embedded script execution.
 * @property {boolean} [hasJSActions] - Some fields have JS actions.
 *   The default value is `false`.
 * @property {Object<string, Array<Object>> | null} [fieldObjects]
 * @property {Map<string, HTMLCanvasElement>} [annotationCanvasMap]
 * @property {TextAccessibilityManager} [accessibilityManager]
 * @property {AnnotationEditorUIManager} [annotationEditorUIManager]
 * @property {StructTreeLayerBuilder} [structTreeLayer]
 */

/**
 * Manage the layer containing all the annotations.
 */
export class AnnotationLayer {

  #accessibilityManager: TextAccessibilityManager;

  #annotationCanvasMap: Map<string, HTMLCanvasElement>;

  #editableAnnotations = new Map<string, AnnotationElement<AnnotationData>>();

  #structTreeLayer = null;

  protected _annotationEditorUIManager;

  public page: PDFPageProxy;

  public viewport: PageViewport;

  public zIndex: number;

  public div: HTMLDivElement;

  constructor(
    div: HTMLDivElement,
    accessibilityManager: TextAccessibilityManager,
    annotationCanvasMap: Map<string, HTMLCanvasElement>,
    annotationEditorUIManager: AnnotationEditorUIManager,
    page: PDFPageProxy,
    viewport: PageViewport,
    structTreeLayer,
  ) {
    this.div = div;
    this.#accessibilityManager = accessibilityManager;
    this.#annotationCanvasMap = annotationCanvasMap;
    this.#structTreeLayer = structTreeLayer || null;
    this.page = page;
    this.viewport = viewport;
    this.zIndex = 0;
    this._annotationEditorUIManager = annotationEditorUIManager;
  }

  hasEditableAnnotations() {
    return this.#editableAnnotations.size > 0;
  }

  async #appendElement(element: HTMLElement, id: string) {
    const contentElement = <HTMLElement>element.firstChild || element;
    const annotationId = (contentElement.id = `${AnnotationPrefix}${id} `);
    const ariaAttributes = await this.#structTreeLayer?.getAriaAttributes(annotationId);
    if (ariaAttributes) {
      for (const [key, value] of ariaAttributes) {
        contentElement.setAttribute(key, value);
      }
    }

    this.div.append(element);
    this.#accessibilityManager?.moveElementInDOM(
      this.div,
      element,
      contentElement,
      /* isRemovable = */ false
    );
  }

  /**
   * Render a new annotation layer with all annotation elements.
   *
   * @param {AnnotationLayerParameters} params
   * @memberof AnnotationLayer
   */
  async render(params) {
    const annotations: AnnotationData[] = params.annotations;
    const layer = this.div;
    setLayerDimensions(layer, this.viewport);

    const popupToElements = new Map<string, PopupAnnotationElement[]>();
    const elementParams = {
      data: <AnnotationData | null>null,
      layer,
      linkService: params.linkService,
      downloadManager: params.downloadManager,
      imageResourcesPath: params.imageResourcesPath || "",
      renderForms: params.renderForms !== false,
      svgFactory: new DOMSVGFactory(),
      annotationStorage: params.annotationStorage || new AnnotationStorage(),
      enableScripting: params.enableScripting === true,
      hasJSActions: params.hasJSActions,
      fieldObjects: params.fieldObjects,
      parent: this,
      elements: <AnnotationElement<AnnotationData>[]>[],
    };

    for (const data of annotations) {
      if (data.noHTML) {
        continue;
      }
      const isPopupAnnotation = data.annotationType === AnnotationType.POPUP;
      if (!isPopupAnnotation) {
        const { width, height } = getRectDims(data.rect!);
        if (width <= 0 || height <= 0) {
          continue; // Ignore empty annotations.
        }
      } else {
        const elements = popupToElements.get(data.id);
        if (!elements) {
          // Ignore popup annotations without a corresponding annotation.
          continue;
        }
        elementParams.elements = elements;
      }
      elementParams.data = data;
      const element = AnnotationElementFactory.create(
        <AnnotationElementParameters<AnnotationData>>elementParams
      );

      if (!element.isRenderable) {
        continue;
      }

      if (!isPopupAnnotation && data.popupRef) {
        const elements = popupToElements.get(data.popupRef);
        if (!elements) {
          popupToElements.set(data.popupRef, [<PopupAnnotationElement>element]);
        } else {
          elements.push(<PopupAnnotationElement>element);
        }
      }

      const rendered = element.render()!;
      if (data.hidden) {
        rendered.style.visibility = "hidden";
      }
      await this.#appendElement(rendered, data.id);

      if (element._isEditable) {
        this.#editableAnnotations.set(element.data.id, element);
        this._annotationEditorUIManager?.renderAnnotationElement(element);
      }
    }

    this.#setAnnotationCanvasMap();
  }

  /**
   * Update the annotation elements on existing annotation layer.
   *
   * @param {AnnotationLayerParameters} viewport
   * @memberof AnnotationLayer
   */
  update(viewport: PageViewport) {
    const layer = this.div;
    this.viewport = viewport;
    setLayerDimensions(layer, { rotation: viewport.rotation });

    this.#setAnnotationCanvasMap();
    layer.hidden = false;
  }

  #setAnnotationCanvasMap() {
    if (!this.#annotationCanvasMap) {
      return;
    }
    const layer = this.div;
    for (const [id, canvas] of this.#annotationCanvasMap) {
      const element = layer.querySelector(`[data - annotation - id= "${id}"]`);
      if (!element) {
        continue;
      }

      canvas.className = "annotationContent";
      const { firstChild } = element;
      if (!firstChild) {
        element.append(canvas);
      } else if (firstChild.nodeName === "CANVAS") {
        firstChild.replaceWith(canvas);
      } else if (!(<HTMLElement>firstChild).classList.contains("annotationContent")) {
        firstChild.before(canvas);
      } else {
        firstChild.after(canvas);
      }
    }
    this.#annotationCanvasMap.clear();
  }

  getEditableAnnotations() {
    return Array.from(this.#editableAnnotations.values());
  }

  getEditableAnnotation(id: string) {
    return this.#editableAnnotations.get(id);
  }
}
