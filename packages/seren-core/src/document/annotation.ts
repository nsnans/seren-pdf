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

import { PopupContent } from "./display/annotation_layer";
import { PointType, RectType, TransformType } from "./display/display_utils";
import { DocumentEvaluatorOptions } from "./display/document_evaluator_options";
import { AnnotationEditorSerial, FreeTextEditorSerial, HighlightEditorSerial, InkEditorSerial, StampEditorSerial } from "./display/editor/state/editor_serializable";
import {
  AnnotationActionEventType,
  AnnotationBorderStyleType,
  AnnotationEditorType,
  AnnotationFieldFlag,
  AnnotationFlag,
  AnnotationReplyType,
  AnnotationType,
  PlatformHelper,
  assert,
  BASELINE_FACTOR,
  FeatureTest,
  getModificationDate,
  IDENTITY_MATRIX,
  info,
  isArrayEqual,
  LINE_DESCENT_FACTOR,
  LINE_FACTOR,
  OPS,
  RenderingIntentFlag,
  shadow,
  stringToPDFString,
  unreachable,
  Util,
  warn,
  MutableArray,
  DestinationType
} from "seren-common";
import { BaseStream } from "./base_stream";
import { bidi } from "../tables/bidi";
import { Catalog } from "./catalog";
import { ColorSpace } from "../color/colorspace";
import { DefaultFieldObject, EvaluatorTextContent, FieldObject, GeneralFieldObject, isFullTextContentItem, StreamSink } from "../common/core_types";
import {
  collectActions,
  escapeString,
  getRotationMatrix,
  getSingleInheritableProperty,
  isNumberArray,
  lookupMatrix,
  lookupNormalRect,
  lookupRect,
  numberToString,
  stringToAsciiOrUTF16BE,
  stringToUTF16String
} from "../utils/core_utils";
import {
  createDefaultAppearance,
  FakeUnicodeFont,
  getPdfColor,
  parseAppearanceStream,
  parseDefaultAppearance,
} from "../worker/default_appearance";
import { PartialEvaluator } from "./evaluator";
import { FileSpec, FileSpecSerializable } from "./file_spec";
import { ErrorFont, Font, Glyph } from "../font/fonts";
import { LocalIdFactory } from "../common/global_id_factory";
import { JpegStream } from "../stream/jpeg_stream";
import { ObjectLoader } from "../common/object_loader";
import { OperatorList } from "../parser/operator_list";
import { PDFManager } from "../worker/pdf_manager";
import { DictKey, isName, isRefsEqual, Name, Ref, RefSet, RefSetCache } from "../../../seren-common/src/primitives";
import { Dict } from "packages/seren-common/src/dict";
import { Stream, StringStream } from "../stream/stream";
import { StructTreeRoot } from "./struct_tree";
import { WorkerTask } from "../worker/worker";
import { writeObject } from "../writer/writer";
import { XRefImpl } from "./xref";
import { CreateStampImageResult } from "../image/image_types";
import { DictImpl } from "./dict_impl";

export interface AnnotationParameters {
  xref: XRefImpl;
  ref: Ref | null;
  dict: Dict;
  subtype: string | null;
  id: string;
  // TODO 这里需要再次验证
  annotationGlobals: AnnotationGlobals,
  collectFields: boolean;
  orphanFields: RefSetCache<Ref, Ref> | null;
  needAppearances: boolean;
  pageIndex: number | null;
  evaluatorOptions: DocumentEvaluatorOptions;
  // TODO 这里需要再次验证
  pageRef: Ref | null;
}

export interface AnnotationGlobals {
  pdfManager: PDFManager;
  acroForm: Dict;
  structTreeRoot: StructTreeRoot | null;
  baseUrl: string;
  attachments: Map<string, FileSpecSerializable> | null;
}

interface AnnotationDependency { ref: Ref; data: string | null; }

export class MarkupAnnotationFactory {

  static async createNewFreeTextAnnotation(
    xref: XRefImpl,
    annotation: FreeTextEditorSerial,
    dependencies: AnnotationDependency[],
    evaluator: PartialEvaluator,
    task: WorkerTask,
    baseFontRef: Ref | null,
  ) {
    if (!annotation.ref) {
      annotation.ref = xref.getNewTemporaryRef();
    }

    const annotationRef = <Ref>annotation.ref;
    const ap = await FreeTextAnnotation.createNewAppearanceStream(annotation, xref, evaluator, task, baseFontRef);
    const buffer = <string[]>[];
    let annotationDict;

    if (ap) {
      const apRef = xref.getNewTemporaryRef();
      annotationDict = FreeTextAnnotation.createNewDict(annotation, xref, apRef, null);
      await writeObject(apRef, ap, buffer, xref.encrypt);
      dependencies.push({ ref: apRef, data: buffer.join("") });
    } else {
      annotationDict = FreeTextAnnotation.createNewDict(annotation, xref, null, null);
    }
    if (Number.isInteger(annotation.parentTreeId)) {
      annotationDict.set(DictKey.StructParent, <number>annotation.parentTreeId);
    }

    buffer.length = 0;
    await writeObject(annotationRef, annotationDict, buffer, xref.encrypt);

    return { ref: annotationRef, data: buffer.join("") };
  }

  static async createNewHighlightAnnotation(
    xref: XRefImpl,
    annotation: HighlightEditorSerial,
    dependencies: AnnotationDependency[]
  ) {
    if (!annotation.ref) {
      annotation.ref = xref.getNewTemporaryRef();
    }

    const annotationRef = <Ref>annotation.ref;
    const ap = await HighlightAnnotation.createNewAppearanceStream(annotation, xref);
    const buffer = <string[]>[];
    let annotationDict;

    if (ap) {
      const apRef = xref.getNewTemporaryRef();
      annotationDict = HighlightAnnotation.createNewDict(annotation, xref, apRef, null);
      await writeObject(apRef, ap, buffer, xref.encrypt);
      dependencies.push({ ref: apRef, data: buffer.join("") });
    } else {
      annotationDict = HighlightAnnotation.createNewDict(annotation, xref, null, null);
    }
    if (Number.isInteger(annotation.parentTreeId)) {
      annotationDict.set(DictKey.StructParent, <number>annotation.parentTreeId);
    }

    buffer.length = 0;
    await writeObject(annotationRef, annotationDict, buffer, xref.encrypt);

    return { ref: annotationRef, data: buffer.join("") };
  }

  static async createNewInkAnnotation(
    xref: XRefImpl,
    annotation: InkEditorSerial,
    dependencies: AnnotationDependency[]
  ) {
    if (!annotation.ref) {
      annotation.ref = xref.getNewTemporaryRef();
    }

    const annotationRef = <Ref>annotation.ref;
    const ap = await InkAnnotation.createNewAppearanceStream(annotation, xref);
    const buffer = <string[]>[];
    let annotationDict;

    if (ap) {
      const apRef = xref.getNewTemporaryRef();
      annotationDict = InkAnnotation.createNewDict(annotation, xref, apRef, null);
      await writeObject(apRef, ap, buffer, xref.encrypt);
      dependencies.push({ ref: apRef, data: buffer.join("") });
    } else {
      annotationDict = InkAnnotation.createNewDict(annotation, xref, null, null);
    }
    if (Number.isInteger(annotation.parentTreeId)) {
      annotationDict.set(DictKey.StructParent, <number>annotation.parentTreeId);
    }

    buffer.length = 0;
    await writeObject(annotationRef, annotationDict, buffer, xref.encrypt);

    return { ref: annotationRef, data: buffer.join("") };
  }


  static async createNewStampAnnotation(
    xref: XRefImpl,
    annotation: StampEditorSerial,
    dependencies: AnnotationDependency[],
    image: CreateStampImageResult
  ) {
    if (!annotation.ref) {
      annotation.ref = xref.getNewTemporaryRef();
    }

    const annotationRef = <Ref>annotation.ref;
    const ap = await StampAnnotation.createNewAppearanceStream(annotation, xref, image);
    const buffer: string[] = [];
    let annotationDict;

    if (ap) {
      const apRef = xref.getNewTemporaryRef();
      annotationDict = StampAnnotation.createNewDict(annotation, xref, apRef, null);
      await writeObject(apRef, ap, buffer, xref.encrypt);
      dependencies.push({ ref: apRef, data: buffer.join("") });
    } else {
      annotationDict = StampAnnotation.createNewDict(annotation, xref, null, null);
    }
    if (Number.isInteger(annotation.parentTreeId)) {
      annotationDict.set(DictKey.StructParent, <number>annotation.parentTreeId);
    }

    buffer.length = 0;
    await writeObject(annotationRef, annotationDict, buffer, xref.encrypt);

    return { ref: annotationRef, data: buffer.join("") };
  }

  static async createNewInkPrintAnnotation(
    annotationGlobals: AnnotationGlobals,
    xref: XRefImpl,
    annotation: InkEditorSerial,
    evaluatorOptions: DocumentEvaluatorOptions
  ) {
    const ap = await InkAnnotation.createNewAppearanceStream(annotation, xref);
    const annotationDict = InkAnnotation.createNewDict(
      annotation, xref, null, ap
    );

    const newAnnotation = new InkAnnotation({
      xref,
      annotationGlobals,
      ref: null,
      subtype: null,
      id: "",

      evaluatorOptions: evaluatorOptions,
      dict: annotationDict,
    });

    if (annotation.ref) {
      newAnnotation.ref = newAnnotation.refToReplace = annotation.ref;
    }

    return newAnnotation;
  }

  static async createNewHightlightPrintAnnotation(
    annotationGlobals: AnnotationGlobals,
    xref: XRefImpl,
    annotation: HighlightEditorSerial,
    evaluatorOptions: DocumentEvaluatorOptions
  ) {
    const ap = await HighlightAnnotation.createNewAppearanceStream(annotation, xref);
    const annotationDict = HighlightAnnotation.createNewDict(
      annotation, xref, null, ap
    );

    const newAnnotation = new HighlightAnnotation({
      dict: annotationDict, xref, annotationGlobals, evaluatorOptions: evaluatorOptions,
    });

    if (annotation.ref) {
      newAnnotation.ref = newAnnotation.refToReplace = annotation.ref;
    }

    return newAnnotation;
  }

  static async createNewFreeTextPrintAnnotation(
    annotationGlobals: AnnotationGlobals,
    xref: XRefImpl,
    annotation: FreeTextEditorSerial,
    evaluator: PartialEvaluator,
    task: WorkerTask,
    evaluatorOptions: DocumentEvaluatorOptions
  ) {
    const ap = await FreeTextAnnotation.createNewAppearanceStream(
      annotation, xref, evaluator, task, null
    );
    const annotationDict = FreeTextAnnotation.createNewDict(
      annotation, xref, null, ap
    );

    const newAnnotation = new FreeTextAnnotation({
      dict: annotationDict, xref, annotationGlobals, evaluatorOptions,
    });

    if (annotation.ref) {
      newAnnotation.ref = newAnnotation.refToReplace = annotation.ref;
    }

    return newAnnotation;
  }

  static async createNewStampPrintAnnotation(
    annotationGlobals: AnnotationGlobals,
    xref: XRefImpl,
    annotation: StampEditorSerial,
    image: CreateStampImageResult | null,
    evaluatorOptions: DocumentEvaluatorOptions
  ) {
    const ap = await StampAnnotation.createNewAppearanceStream(annotation, xref, image!);
    const annotationDict = StampAnnotation.createNewDict(
      annotation, xref, null, ap
    );

    const newAnnotation = new StampAnnotation({
      dict: annotationDict, xref, annotationGlobals, evaluatorOptions,
    });

    if (annotation.ref) {
      newAnnotation.ref = newAnnotation.refToReplace = annotation.ref;
    }

    return newAnnotation;
  }
}

export class AnnotationFactory {

  static createGlobals(pdfManager: PDFManager): Promise<AnnotationGlobals | null> {
    return Promise.all([
      pdfManager.ensureCatalog(catalog => catalog.acroForm),
      pdfManager.ensureCatalog(catalog => catalog.structTreeRoot),
      // Only necessary to prevent the `Catalog.baseUrl`-getter, used
      // with some Annotations, from throwing and thus breaking parsing:
      pdfManager.ensureCatalog(catalog => catalog.baseUrl),
      // Only necessary to prevent the `Catalog.attachments`-getter, used
      // with "GoToE" actions, from throwing and thus breaking parsing:
      pdfManager.ensureCatalog(catalog => catalog.attachments),
    ] as const).then(
      // eslint-disable-next-line arrow-body-style
      ([acroForm, structTreeRoot, baseUrl, attachments]) => {
        return {
          pdfManager, structTreeRoot, baseUrl, attachments,
          acroForm: acroForm instanceof DictImpl ? acroForm : DictImpl.empty,
        };
      },
      reason => {
        warn(`createGlobals: "${reason}".`);
        return null;
      }
    );
  }

  /**
   * Create an `Annotation` object of the correct type for the given reference
   * to an annotation dictionary. This yields a promise that is resolved when
   * the `Annotation` object is constructed.
   *
   * @param {XRefImpl} xref
   * @param {Object} ref
   * @params {Object} annotationGlobals
   * @param {Object} idFactory
   * @param {boolean} [collectFields]
   * @param {Object} [orphanFields]
   * @param {Object} [pageRef]
   * @returns {Promise} A promise that is resolved with an {Annotation}
   *   instance.
   */
  static async create(
    xref: XRefImpl,
    ref: Ref,
    annotationGlobals: AnnotationGlobals,
    idFactory: LocalIdFactory | null,
    collectFields: boolean,
    orphanFields: RefSetCache<Ref, Ref> | null,
    pageRef: Ref | null
  ): Promise<Annotation<AnnotationData>> {

    const pdfManager = annotationGlobals.pdfManager;
    const pageIndex = collectFields ? await this._getPageIndex(xref, ref, pdfManager) : null;

    const createFn = (factory: typeof AnnotationFactory) => factory._create(
      xref, ref, annotationGlobals, idFactory!, collectFields, orphanFields, pageIndex, pageRef,
    )!;

    return pdfManager.ensure(AnnotationFactory, createFn);
  }

  private static _create(
    xref: XRefImpl, ref: Ref, annotationGlobals: AnnotationGlobals, idFactory: LocalIdFactory,
    collectFields = false, orphanFields: RefSetCache<Ref, Ref> | null = null, pageIndex: number | null = null,
    pageRef: Ref | null = null
  ): Annotation<AnnotationData> | null {
    const dict = xref.fetchIfRef(ref);
    if (!(dict instanceof DictImpl)) {
      return null;
    }

    const { acroForm, pdfManager } = annotationGlobals;
    const id = ref instanceof Ref ? ref.toString() : `annot_${idFactory.createObjId()}`;

    // Determine the annotation's subtype.
    let subtypeVal = dict.getValue(DictKey.Subtype);
    const subtype = subtypeVal instanceof Name ? subtypeVal.name : null;

    // Return the right annotation object based on the subtype and field type.
    const parameters: AnnotationParameters = {
      xref, ref, dict, subtype, id, annotationGlobals, collectFields,
      orphanFields, pageIndex, pageRef, evaluatorOptions: pdfManager.evaluatorOptions,
      needAppearances: !collectFields && acroForm.getValue(DictKey.NeedAppearances) === true,
    };

    switch (subtype) {

      case "Link":
        return new LinkAnnotation(parameters);

      case "Text":
        return new TextAnnotation(parameters);

      case "Widget":
        let fieldType = getSingleInheritableProperty(dict, DictKey.FT);
        fieldType = fieldType instanceof Name ? fieldType.name : null;

        switch (fieldType) {
          case "Tx":
            return new TextWidgetAnnotation(parameters);
          case "Btn":
            return new ButtonWidgetAnnotation(parameters);
          case "Ch":
            return new ChoiceWidgetAnnotation(parameters);
          case "Sig":
            return new SignatureWidgetAnnotation(parameters);
        }
        warn(
          `Unimplemented widget field type "${fieldType}", ` +
          "falling back to base field type."
        );
        return new WidgetAnnotation(parameters);

      case "Popup":
        return new PopupAnnotation(parameters);

      case "FreeText":
        return new FreeTextAnnotation(parameters);

      case "Line":
        return new LineAnnotation(parameters);

      case "Square":
        return new SquareAnnotation(parameters);

      case "Circle":
        return new CircleAnnotation(parameters);

      case "PolyLine":
        return new PolylineAnnotation(parameters);

      case "Polygon":
        return new PolygonAnnotation(parameters);

      case "Caret":
        return new CaretAnnotation(parameters);

      case "Ink":
        return new InkAnnotation(parameters);

      case "Highlight":
        return new HighlightAnnotation(parameters);

      case "Underline":
        return new UnderlineAnnotation(parameters);

      case "Squiggly":
        return new SquigglyAnnotation(parameters);

      case "StrikeOut":
        return new StrikeOutAnnotation(parameters);

      case "Stamp":
        return new StampAnnotation(parameters);

      case "FileAttachment":
        return new FileAttachmentAnnotation(parameters);

      default:
        if (!collectFields) {
          if (!subtype) {
            warn("Annotation is missing the required /Subtype.");
          } else {
            warn(
              `Unimplemented annotation type "${subtype}", ` +
              "falling back to base annotation."
            );
          }
        }
        return new Annotation(parameters);
    }
  }

  static async _getPageIndex(xref: XRefImpl, ref: Ref, pdfManager: PDFManager) {
    try {
      const annotDict = await xref.fetchIfRefAsync(ref);
      if (!(annotDict instanceof DictImpl)) {
        return -1;
      }
      const pageRef = annotDict.getRaw(DictKey.P);
      if (pageRef instanceof Ref) {
        try {
          const promise = pdfManager.ensureCatalog(catalog => catalog.getPageIndex(pageRef));
          const pageIndex = await promise;
          return pageIndex;
        } catch (ex) {
          info(`_getPageIndex -- not a valid page reference: "${ex}".`);
        }
      }
      if (annotDict.has(DictKey.Kids)) {
        return -1; // Not an annotation reference.
      }
      // Fallback to, potentially, checking the annotations of all pages.
      // PLEASE NOTE: This could force the *entire* PDF document to load,
      //              hence it absolutely cannot be done unconditionally.
      const numPages = await pdfManager.ensureDoc(doc => doc.numPages);

      for (let pageIndex = 0; pageIndex < numPages; pageIndex++) {

        const page = await pdfManager.getPage(pageIndex);

        const annotations = <Ref[]>await pdfManager.ensure(page, page => page.annotations);

        for (const annotRef of annotations) {
          if (annotRef instanceof Ref && isRefsEqual(annotRef, ref)) {
            return pageIndex;
          }
        }
      }
    } catch (ex) {
      warn(`_getPageIndex: "${ex}".`);
    }
    return -1;
  }

  static generateImages(annotations: Iterable<Record<string, any>>, xref: XRefImpl, isOffscreenCanvasSupported: boolean) {
    if (!isOffscreenCanvasSupported) {
      warn(
        "generateImages: OffscreenCanvas is not supported, cannot save or print some annotations with images."
      );
      return null;
    }
    let imagePromises = null;
    for (const { bitmapId, bitmap } of annotations) {
      if (!bitmap) {
        continue;
      }
      imagePromises ||= new Map<string, Promise<CreateStampImageResult>>();
      // bitmapId 是 string类型
      imagePromises.set(bitmapId, StampAnnotation.createImage(bitmap, xref));
    }

    return imagePromises;
  }

  static async saveNewAnnotations(
    evaluator: PartialEvaluator,
    task: WorkerTask,
    annotations: AnnotationEditorSerial[],
    imagePromises: Map<string, Promise<CreateStampImageResult>> | null
  ) {
    const xref = evaluator.xref;
    let baseFontRef;
    const dependencies: AnnotationDependency[] = [];
    const promises = [];
    const { isOffscreenCanvasSupported } = evaluator.options;

    for (const annotation of annotations) {
      if (annotation.deleted) {
        continue;
      }
      switch (annotation.annotationType) {
        case AnnotationEditorType.FREETEXT:
          if (!baseFontRef) {
            const baseFont = new DictImpl(xref);
            baseFont.set(DictKey.BaseFont, Name.get("Helvetica"));
            baseFont.set(DictKey.Type, Name.get("Font"));
            baseFont.set(DictKey.Subtype, Name.get("Type1"));
            baseFont.set(DictKey.Encoding, Name.get("WinAnsiEncoding"));
            const buffer = <string[]>[];
            baseFontRef = xref.getNewTemporaryRef();
            await writeObject(baseFontRef, baseFont, buffer, xref.encrypt);
            dependencies.push({ ref: baseFontRef, data: buffer.join("") });
          }
          promises.push(MarkupAnnotationFactory.createNewFreeTextAnnotation(
            xref, <FreeTextEditorSerial>annotation, dependencies, evaluator, task, baseFontRef
          ));
          break;
        case AnnotationEditorType.HIGHLIGHT:
          if ((<{ quadPoints?: number[] }>annotation).quadPoints) {
            promises.push(MarkupAnnotationFactory.createNewHighlightAnnotation(
              xref, <HighlightEditorSerial>annotation, dependencies
            ));
          } else {
            promises.push(MarkupAnnotationFactory.createNewInkAnnotation(
              xref, <InkEditorSerial>annotation, dependencies
            ));
          }
          break;
        case AnnotationEditorType.INK:
          promises.push(MarkupAnnotationFactory.createNewInkAnnotation(
            xref, <InkEditorSerial>annotation, dependencies
          ));
          break;
        case AnnotationEditorType.STAMP:
          const image = isOffscreenCanvasSupported ? await imagePromises?.get(annotation.bitmapId!) : null;
          if (image?.imageStream) {
            const { imageStream, smaskStream } = image;
            const buffer = <string[]>[];
            if (smaskStream) {
              const smaskRef = xref.getNewTemporaryRef();
              await writeObject(smaskRef, smaskStream, buffer, xref.encrypt);
              dependencies.push({ ref: smaskRef, data: buffer.join("") });
              imageStream.dict!.set(DictKey.SMask, smaskRef);
              buffer.length = 0;
            }
            const imageRef = (image.imageRef = xref.getNewTemporaryRef());
            await writeObject(imageRef, imageStream, buffer, xref.encrypt);
            dependencies.push({ ref: imageRef, data: buffer.join("") });
            image.imageStream = image.smaskStream = null;
          }
          promises.push(MarkupAnnotationFactory.createNewStampAnnotation(
            xref, <StampEditorSerial>annotation, dependencies, image!
          ));
          break;
      }
    }

    return { annotations: await Promise.all(promises), dependencies };
  }

  static async printNewAnnotations(
    annotationGlobals: AnnotationGlobals,
    evaluator: PartialEvaluator,
    task: WorkerTask,
    annotations: AnnotationEditorSerial[],
    imagePromises: Map<string, Promise<CreateStampImageResult>> | null
  ): Promise<Annotation<AnnotationData>[] | null> {
    if (!annotations) {
      return null;
    }

    const { options, xref } = evaluator;
    const promises = [];
    for (const annotation of annotations) {
      if (annotation.deleted) {
        continue;
      }
      switch (annotation.annotationType) {
        case AnnotationEditorType.FREETEXT:
          promises.push(MarkupAnnotationFactory.createNewFreeTextPrintAnnotation(
            annotationGlobals, xref, <FreeTextEditorSerial>annotation, evaluator, task, options
          ));
          break;
        case AnnotationEditorType.HIGHLIGHT:
          if ((<{ quadPoints?: number[] }>annotation).quadPoints) {
            promises.push(MarkupAnnotationFactory.createNewHightlightPrintAnnotation(
              annotationGlobals, xref, <HighlightEditorSerial>annotation, options
            ));
          } else {
            promises.push(MarkupAnnotationFactory.createNewInkPrintAnnotation(
              annotationGlobals, xref, <InkEditorSerial>annotation, options
            ));
          }
          break;
        case AnnotationEditorType.INK:
          promises.push(MarkupAnnotationFactory.createNewInkPrintAnnotation(
            annotationGlobals, xref, <InkEditorSerial>annotation, options
          ));
          break;
        case AnnotationEditorType.STAMP:
          const image = options.isOffscreenCanvasSupported ? await imagePromises?.get(annotation.bitmapId!) : null;
          if (image?.imageStream) {
            const { imageStream, smaskStream } = image;
            if (smaskStream) {
              imageStream.dict!.set(DictKey.SMask, smaskStream);
            }
            image.imageRef = new JpegStream(imageStream, imageStream.length);
            image.imageStream = image.smaskStream = null;
          }
          promises.push(MarkupAnnotationFactory.createNewStampPrintAnnotation(
            annotationGlobals, xref, <StampEditorSerial>annotation, image || null, options
          ));
          break;
      }
    }

    return Promise.all(promises);
  }
}

function getRgbColor(color: MutableArray<number>, defaultColor: Uint8ClampedArray<ArrayBuffer> | null = new Uint8ClampedArray(3)) {
  if (!Array.isArray(color)) {
    return defaultColor;
  }

  const rgbColor = defaultColor || new Uint8ClampedArray(3);
  switch (color.length) {
    case 0: // Transparent, which we indicate with a null value
      return null;

    case 1: // Convert grayscale to RGB
      ColorSpace.singletons.gray.getRgbItem(color, 0, rgbColor, 0);
      return rgbColor;

    case 3: // Convert RGB percentages to RGB
      ColorSpace.singletons.rgb.getRgbItem(color, 0, rgbColor, 0);
      return rgbColor;

    case 4: // Convert CMYK to RGB
      ColorSpace.singletons.cmyk.getRgbItem(color, 0, rgbColor, 0);
      return rgbColor;

    default:
      return defaultColor;
  }
}

function getPdfColorArray(color: MutableArray<number>) {
  return Array.from(color, (c: number) => c / 255);
}

export function getQuadPoints(dict: Dict, rect: number[] | null) {
  // The region is described as a number of quadrilaterals.
  // Each quadrilateral must consist of eight coordinates.
  const quadPoints = dict.getArrayValue(DictKey.QuadPoints);
  if (
    !isNumberArray(quadPoints, null) ||
    quadPoints.length === 0 ||
    quadPoints.length % 8 > 0
  ) {
    return null;
  }

  const newQuadPoints = new Float32Array(quadPoints.length);
  for (let i = 0, ii = quadPoints.length; i < ii; i += 8) {
    // Each series of eight numbers represents the coordinates for one
    // quadrilateral in the order [x1, y1, x2, y2, x3, y3, x4, y4].
    // Convert this to an array of objects with x and y coordinates.
    const [x1, y1, x2, y2, x3, y3, x4, y4] = quadPoints.slice(i, i + 8);
    const minX = Math.min(x1, x2, x3, x4);
    const maxX = Math.max(x1, x2, x3, x4);
    const minY = Math.min(y1, y2, y3, y4);
    const maxY = Math.max(y1, y2, y3, y4);
    // The quadpoints should be ignored if any coordinate in the array
    // lies outside the region specified by the rectangle. The rectangle
    // can be `null` for markup annotations since their rectangle may be
    // incorrect (fixes bug 1538111).
    if (rect !== null && (minX < rect[0] || maxX > rect[2] || minY < rect[1] || maxY > rect[3])) {
      return null;
    }
    // The PDF specification states in section 12.5.6.10 (figure 64) that the
    // order of the quadpoints should be bottom left, bottom right, top right
    // and top left. However, in practice PDF files use a different order,
    // namely bottom left, bottom right, top left and top right (this is also
    // mentioned on https://github.com/highkite/pdfAnnotate#QuadPoints), so
    // this is the actual order we should work with. However, the situation is
    // even worse since Adobe's own applications and other applications violate
    // the specification and create annotations with other orders, namely top
    // left, top right, bottom left and bottom right or even top left,
    // top right, bottom right and bottom left. To avoid inconsistency and
    // broken rendering, we normalize all lists to put the quadpoints in the
    // same standard order (see https://stackoverflow.com/a/10729881).
    newQuadPoints.set([minX, maxY, maxX, maxY, minX, minY, maxX, minY], i);
  }
  return newQuadPoints;
}

function getTransformMatrix(rect: RectType, bbox: RectType, matrix: TransformType): TransformType {
  // 12.5.5: Algorithm: Appearance streams
  const [minX, minY, maxX, maxY] = Util.getAxialAlignedBoundingBox(bbox, matrix);

  if (minX === maxX || minY === maxY) {
    // From real-life file, bbox was [0, 0, 0, 0]. In this case,
    // just apply the transform for rect
    return [1, 0, 0, 1, rect[0], rect[1]];
  }

  const xRatio = (rect[2] - rect[0]) / (maxX - minX);
  const yRatio = (rect[3] - rect[1]) / (maxY - minY);
  return [xRatio, 0, 0, yRatio, rect[0] - minX * xRatio, rect[1] - minY * yRatio];
}

export interface AnnotationData {
  richText: PopupContent | null;
  titleObj: StringObj | null;
  alternativeText: string | null;
  annotationFlags: number;
  borderStyle: AnnotationBorderStyle;
  // TODO 要再推断一下
  color: Uint8ClampedArray<ArrayBuffer> | null;
  backgroundColor: Uint8ClampedArray<ArrayBuffer> | null;
  borderColor: Uint8ClampedArray<ArrayBuffer> | null;
  rotation: number;
  contentsObj: StringObj;
  hasAppearance: boolean;
  id: string;
  modificationDate: string | null;
  rect: RectType | null;
  subtype: string | null;
  hasOwnCanvas: boolean;
  noRotate: boolean;
  noHTML: boolean;
  isEditable: boolean;
  structParent: number;
  kidIds?: string[]
  fieldName?: string
  pageIndex?: number;
  it?: string;
  quadPoints?: Float32Array<ArrayBuffer>;
  defaultAppearanceData?: {
    fontSize: number;
    fontName: string;
    fontColor: Uint8ClampedArray<ArrayBuffer>;
  };
  textPosition?: number[];
  textContent?: string[];
  actions?: Map<string, string[]>;
  annotationType?: AnnotationType;
  popupRef?: string | null;
  hidden?: boolean;
}

export interface StringObj { str: string; dir: string; }

interface AnnotationSaveRef {
  ref: Ref | null;
  data: string;
  needAppearances?: boolean;
}


export class Annotation<DATA extends AnnotationData> {

  public ref: Ref | null;

  protected _needAppearances: boolean;

  protected _isOffscreenCanvasSupported: boolean;

  protected _defaultAppearance: string = "";

  protected modificationDate: string | null = null;

  protected flags: number = 0;

  protected rectangle: RectType = [0, 0, 0, 0];

  protected lineEndings: string[] = [];

  protected rotation: number = 0;

  protected borderColor: Uint8ClampedArray<ArrayBuffer> | null = null;

  protected backgroundColor: Uint8ClampedArray<ArrayBuffer> | null = null;

  protected borderStyle: AnnotationBorderStyle = new AnnotationBorderStyle();

  protected appearance: BaseStream | null = null;

  protected oc: Dict | null = null;

  public data: DATA;

  protected _contents: StringObj = { str: "", dir: "" };

  protected _title: StringObj = { str: "", dir: "" };

  protected _streams: BaseStream[];

  protected color: Uint8ClampedArray<ArrayBuffer> | null = null;

  protected _fallbackFontDict: Dict | null;

  public refToReplace: Ref | null = null;

  constructor(params: AnnotationParameters) {
    const { dict, xref, annotationGlobals, ref, orphanFields } = params;
    const parentRef = orphanFields?.get(ref!);
    if (parentRef) {
      dict.set(DictKey.Parent, parentRef);
    }

    this.setTitle(<string>dict.getValue(DictKey.T));
    this.setContents(dict.getValue(DictKey.Contents));
    this.setModificationDate(dict.getValue(DictKey.M));
    this.setFlags(<number>dict.getValue(DictKey.F));
    this.setRectangle(dict.getArrayValue(DictKey.Rect));
    this.setColor(dict.getArrayValue(DictKey.C));
    this.setBorderStyle(dict);
    this.setAppearance(dict);
    this.setOptionalContent(dict);

    const MK = dict.getValue(DictKey.MK);
    this.setBorderAndBackgroundColors(MK);
    this.setRotation(MK, dict);
    this.ref = params.ref instanceof Ref ? params.ref : null;

    this._streams = [];
    if (this.appearance) {
      this._streams.push(this.appearance);
    }

    // The annotation cannot be changed (neither its position/visibility nor its
    // contents), hence we can just display its appearance and don't generate
    // a HTML element for it.
    const isLocked = !!(this.flags & AnnotationFlag.LOCKED);
    const isContentLocked = !!(this.flags & AnnotationFlag.LOCKEDCONTENTS);

    // Expose public properties using a data object.
    this.data = <DATA>{
      annotationFlags: this.flags,
      borderStyle: this.borderStyle,
      color: this.color,
      backgroundColor: this.backgroundColor,
      borderColor: this.borderColor,
      rotation: this.rotation,
      contentsObj: this._contents,
      hasAppearance: !!this.appearance,
      id: params.id,
      modificationDate: this.modificationDate,
      rect: this.rectangle,
      subtype: params.subtype,
      hasOwnCanvas: false,
      noRotate: !!(this.flags & AnnotationFlag.NOROTATE),
      noHTML: isLocked && isContentLocked,
      isEditable: false,
      structParent: -1,
    };

    if (annotationGlobals.structTreeRoot) {
      let structParent = dict.getValue(DictKey.StructParent);
      this.data.structParent = structParent =
        Number.isInteger(structParent) && structParent >= 0 ? structParent : -1;

      annotationGlobals.structTreeRoot.addAnnotationIdToPage(
        params.pageRef!,
        structParent
      );
    }

    if (params.collectFields) {
      // Fields can act as container for other fields and have
      // some actions even if no Annotation inherit from them.
      // Those fields can be referenced by CO (calculation order).
      const kids = dict.getValue(DictKey.Kids);
      if (Array.isArray(kids)) {
        const kidIds = <string[]>[];
        for (const kid of kids) {
          if (kid instanceof Ref) {
            kidIds.push(kid.toString());
          }
        }
        if (kidIds.length !== 0) {
          this.data.kidIds = kidIds;
        }
      }

      this.data.actions = collectActions(xref, dict, AnnotationActionEventType) ?? undefined;
      this.data.fieldName = this._constructFieldName(dict);
      this.data.pageIndex = params.pageIndex ?? undefined;
    }

    const it = dict.getValue(DictKey.IT);
    if (it instanceof Name) {
      this.data.it = it.name;
    }

    this._isOffscreenCanvasSupported = params.evaluatorOptions.isOffscreenCanvasSupported;
    this._fallbackFontDict = null;
    this._needAppearances = false;
  }

  /**
   * @private
   */
  _hasFlag(flags: number, flag: number) {
    return !!(flags & flag);
  }

  _buildFlags(noView?: boolean, noPrint?: boolean) {
    let { flags } = this;
    if (noView === undefined) {
      if (noPrint === undefined) {
        return null;
      }
      if (noPrint) {
        return flags & ~AnnotationFlag.PRINT;
      }
      return (flags & ~AnnotationFlag.HIDDEN) | AnnotationFlag.PRINT;
    }

    if (noView) {
      flags |= AnnotationFlag.PRINT;
      if (noPrint) {
        // display === 1.
        return (flags & ~AnnotationFlag.NOVIEW) | AnnotationFlag.HIDDEN;
      }
      // display === 3.
      return (flags & ~AnnotationFlag.HIDDEN) | AnnotationFlag.NOVIEW;
    }

    flags &= ~(AnnotationFlag.HIDDEN | AnnotationFlag.NOVIEW);
    if (noPrint) {
      // display === 2.
      return flags & ~AnnotationFlag.PRINT;
    }

    // display === 0.
    return flags | AnnotationFlag.PRINT;
  }

  /**
   * @private
   */
  _isViewable(flags: number) {
    return (
      !this._hasFlag(flags, AnnotationFlag.INVISIBLE) &&
      !this._hasFlag(flags, AnnotationFlag.NOVIEW)
    );
  }

  /**
   * @private
   */
  _isPrintable(flags: number) {
    // In Acrobat, hidden flag cancels the print one
    // (see annotation_hidden_print.pdf).
    return (
      this._hasFlag(flags, AnnotationFlag.PRINT) &&
      !this._hasFlag(flags, AnnotationFlag.HIDDEN) &&
      !this._hasFlag(flags, AnnotationFlag.INVISIBLE)
    );
  }

  /**
   * Check if the annotation must be displayed by taking into account
   * the value found in the annotationStorage which may have been set
   * through JS.
   *
   * @public
   * @memberof Annotation
   * @param {AnnotationStorage} [annotationStorage] - Storage for annotation
   * @param {boolean} [_renderForms] - if true widgets are rendered thanks to
   *                                   the annotation layer.
   */
  mustBeViewed(annotationStorage: Map<string, Record<string, any>> | null, _renderForms: boolean) {
    const noView = annotationStorage?.get(this.data.id)?.noView;
    if (noView !== undefined) {
      return !noView;
    }
    return this.viewable && !this._hasFlag(this.flags, AnnotationFlag.HIDDEN);
  }

  /**
   * Check if the annotation must be printed by taking into account
   * the value found in the annotationStorage which may have been set
   * through JS.
   *
   * @public
   * @memberof Annotation
   * @param {AnnotationStorage} [annotationStorage] - Storage for annotation
   */
  mustBePrinted(annotationStorage: Map<string, Record<string, any>> | null) {
    const noPrint = annotationStorage?.get(this.data.id)?.noPrint;
    if (noPrint !== undefined) {
      return !noPrint;
    }
    return this.printable;
  }

  mustBeViewedWhenEditing(isEditing: boolean, modifiedIds: Set<string> | null = null) {
    return isEditing ? !this.data.isEditable : !modifiedIds?.has(this.data.id);
  }

  /**
   * @type {boolean}
   */
  get viewable() {
    if (this.data.quadPoints === null) {
      return false;
    }
    if (this.flags === 0) {
      return true;
    }
    return this._isViewable(this.flags);
  }

  /**
   * @type {boolean}
   */
  get printable() {
    if (this.data.quadPoints === null) {
      return false;
    }
    if (this.flags === 0) {
      return false;
    }
    return this._isPrintable(this.flags);
  }

  /**
   * @private
   */
  _parseStringHelper(data: string) {
    const str = typeof data === "string" ? stringToPDFString(data) : "";
    const dir = str && bidi(str).dir === "rtl" ? "rtl" : "ltr";

    return { str, dir };
  }

  setDefaultAppearance(params: AnnotationParameters) {
    const { dict, annotationGlobals } = params;

    const defaultAppearance = getSingleInheritableProperty(dict, DictKey.DA) || annotationGlobals.acroForm.getValue(DictKey.DA);
    this._defaultAppearance = typeof defaultAppearance === "string" ? defaultAppearance : "";
    this.data.defaultAppearanceData = parseDefaultAppearance(this._defaultAppearance);
  }

  /**
   * Set the title.
   *
   * @param {string} title - The title of the annotation, used e.g. with
   *   PopupAnnotations.
   */
  setTitle(title: string) {
    this._title = this._parseStringHelper(title);
  }

  /**
   * Set the contents.
   *
   * @param {string} contents - Text to display for the annotation or, if the
   *                            type of annotation does not display text, a
   *                            description of the annotation's contents
   */
  setContents(contents: string) {
    this._contents = this._parseStringHelper(contents);
  }

  /**
   * Set the modification date.
   *
   * @public
   * @memberof Annotation
   * @param {string} modificationDate - PDF date string that indicates when the
   *                                    annotation was last modified
   */
  setModificationDate(modificationDate: string) {
    this.modificationDate = typeof modificationDate === "string" ? modificationDate : null;
  }

  /**
   * Set the flags.
   *
   * @public
   * @memberof Annotation
   * @param {number} flags - Unsigned 32-bit integer specifying annotation
   *                         characteristics
   * @see {@link shared/util.js}
   */
  setFlags(flags: number) {
    this.flags = Number.isInteger(flags) && flags > 0 ? flags : 0;
    if (
      this.flags & AnnotationFlag.INVISIBLE &&
      this.constructor.name !== "Annotation"
    ) {
      // From the pdf spec v1.7, section 12.5.3 (Annotation Flags):
      //   If set, do not display the annotation if it does not belong to one of
      //   the standard annotation types and no annotation handler is available.
      //
      // So we can remove the flag in case we have a known annotation type.
      this.flags ^= AnnotationFlag.INVISIBLE;
    }
  }

  /**
   * Check if a provided flag is set.
   */
  hasFlag(flag: number) {
    return this._hasFlag(this.flags, flag);
  }

  /**
   * Set the rectangle.
   *
   * @public
   * @memberof Annotation
   * @param {Array} rectangle - The rectangle array with exactly four entries
   */
  setRectangle(rectangle: [number, number, number, number]) {
    this.rectangle = <RectType>lookupNormalRect(rectangle, [0, 0, 0, 0])!;
  }

  /**
   * Set the color and take care of color space conversion.
   * The default value is black, in RGB color space.
   *
   * @public
   * @memberof Annotation
   * @param color - The color array containing either 
   * 0 (transparent), 1 (grayscale), 3 (RGB) or 4 (CMYK) elements
   */
  setColor(color: MutableArray<number>) {
    this.color = getRgbColor(color);
  }

  /**
   * Set the line endings; should only be used with specific annotation types.
   * @param {Array} lineEndings - The line endings array.
   */
  setLineEndings(lineEndings: Name[]) {
    if (PlatformHelper.isMozCental()) {
      throw new Error("Not implemented: setLineEndings");
    }
    this.lineEndings = ["None", "None"]; // The default values.

    if (Array.isArray(lineEndings) && lineEndings.length === 2) {
      for (let i = 0; i < 2; i++) {
        const obj = lineEndings[i];

        if (obj instanceof Name) {
          switch (obj.name) {
            case "None":
              continue;
            case "Square":
            case "Circle":
            case "Diamond":
            case "OpenArrow":
            case "ClosedArrow":
            case "Butt":
            case "ROpenArrow":
            case "RClosedArrow":
            case "Slash":
              this.lineEndings[i] = obj.name;
              continue;
          }
        }
        warn(`Ignoring invalid lineEnding: ${obj}`);
      }
    }
  }

  setRotation(mk: Dict, dict: Dict) {
    this.rotation = 0;
    let angle = mk instanceof DictImpl ? mk.getValue(DictKey.R) || 0 : dict.getValue(DictKey.Rotate) || 0;
    if (Number.isInteger(angle) && angle !== 0) {
      angle %= 360;
      if (angle < 0) {
        angle += 360;
      }
      if (angle % 90 === 0) {
        this.rotation = angle;
      }
    }
  }

  /**
   * Set the color for background and border if any.
   * The default values are transparent.
   *
   * @public
   * @memberof Annotation
   * @param {Dict} mk - The MK dictionary
   */
  setBorderAndBackgroundColors(mk: Dict) {
    if (mk instanceof DictImpl) {
      this.borderColor = getRgbColor(mk.getArrayValue(DictKey.BC), null);
      this.backgroundColor = getRgbColor(mk.getArrayValue(DictKey.BG), null);
    } else {
      this.borderColor = this.backgroundColor = null;
    }
  }

  /**
   * Set the border style (as AnnotationBorderStyle object).
   *
   * @public
   * @memberof Annotation
   * @param {Dict} borderStyle - The border style dictionary
   */
  setBorderStyle(borderStyle: Dict) {
    if (PlatformHelper.isTesting()) {
      assert(!!this.rectangle, "setRectangle must have been called previously.");
    }

    this.borderStyle = new AnnotationBorderStyle();
    if (!(borderStyle instanceof DictImpl)) {
      return;
    }
    if (borderStyle.has(DictKey.BS)) {
      const dict = borderStyle.getValue(DictKey.BS);

      if (dict instanceof DictImpl) {
        const dictType = dict.getValue(DictKey.Type);

        if (!dictType || isName(dictType, "Border")) {
          this.borderStyle.setWidth(<number>dict.getValue(DictKey.W), this.rectangle);
          this.borderStyle.setStyle(dict.getValue(DictKey.S));
          this.borderStyle.setDashArray(<number[]>dict.getArrayValue(DictKey.D));
        }
      }
    } else if (borderStyle.has(DictKey.Border)) {
      const array = borderStyle.getArrayValue(DictKey.Border);
      if (Array.isArray(array) && array.length >= 3) {
        this.borderStyle.setHorizontalCornerRadius(<number>array[0]);
        this.borderStyle.setVerticalCornerRadius(<number>array[1]);
        this.borderStyle.setWidth(<number>array[2], this.rectangle);

        if (array.length === 4) {
          // Dash array available
          this.borderStyle.setDashArray(<number[]>array[3], /* forceStyle = */ true);
        }
      }
    } else {
      // There are no border entries in the dictionary. According to the
      // specification, we should draw a solid border of width 1 in that
      // case, but Adobe Reader did not implement that part of the
      // specification and instead draws no border at all, so we do the same.
      // See also https://github.com/mozilla/pdf.js/issues/6179.
      this.borderStyle.setWidth(0);
    }
  }

  /**
   * Set the (normal) appearance.
   *
   * @public
   * @memberof Annotation
   * @param {Dict} dict - The annotation's data dictionary
   */
  setAppearance(dict: Dict) {
    this.appearance = null;

    const appearanceStates = dict.getValue(DictKey.AP);
    if (!(appearanceStates instanceof DictImpl)) {
      return;
    }

    // In case the normal appearance is a stream, then it is used directly.
    const normalAppearanceState = appearanceStates.getValue(DictKey.N);
    if (normalAppearanceState instanceof BaseStream) {
      this.appearance = normalAppearanceState;
      return;
    }
    if (!(normalAppearanceState instanceof DictImpl)) {
      return;
    }

    // In case the normal appearance is a dictionary, the `AS` entry provides
    // the key of the stream in this dictionary.
    const as = dict.getValue(DictKey.AS);
    if (!(as instanceof Name) || !normalAppearanceState.has(<DictKey>as.name)) {
      return;
    }
    const appearance = normalAppearanceState.getValue(<DictKey>as.name);
    if (appearance instanceof BaseStream) {
      this.appearance = appearance;
    }
  }

  setOptionalContent(dict: Dict) {
    this.oc = null;

    const oc = dict.getValue(DictKey.OC);
    if (oc instanceof Name) {
      warn("setOptionalContent: Support for /Name-entry is not implemented.");
    } else if (oc instanceof DictImpl) {
      this.oc = oc;
    }
  }

  async loadResources(keys: string[], appearance: BaseStream) {
    return appearance.dict!.getAsyncValue(DictKey.Resources).then((resources: Dict) => {
      if (!resources) {
        return undefined;
      }
      const objectLoader = new ObjectLoader(resources, keys, <XRefImpl>resources.xref);
      return objectLoader.load().then(() => resources);
    });
  }

  async getOperatorList(evaluator: PartialEvaluator, task: WorkerTask, intent: number,
    _annotationStorage: Map<string, Record<string, any>> | null): Promise<{
      opList: OperatorList | null;
      separateForm: boolean;
      separateCanvas: boolean;
    }> {
    const { hasOwnCanvas, id } = this.data;
    const rect = this.data.rect!;
    let appearance = this.appearance;
    const isUsingOwnCanvas = !!(
      hasOwnCanvas && intent & RenderingIntentFlag.DISPLAY
    );
    if (isUsingOwnCanvas && (rect[0] === rect[2] || rect[1] === rect[3])) {
      // Empty annotation, don't draw anything.
      this.data.hasOwnCanvas = false;
      return { opList: new OperatorList(), separateForm: false, separateCanvas: false };
    }
    if (!appearance) {
      if (!isUsingOwnCanvas) {
        return { opList: new OperatorList(), separateForm: false, separateCanvas: false };
      }
      appearance = new StringStream("");
      appearance.dict = new DictImpl();
    }

    const appearanceDict = appearance.dict!;
    const resources = await this.loadResources(
      ["ExtGState", "ColorSpace", "Pattern", "Shading", "XObject", "Font"],
      appearance
    );
    const bbox = <RectType>lookupRect(appearanceDict.getArrayValue(DictKey.BBox), [0, 0, 1, 1]);
    const matrix = <TransformType>lookupMatrix(
      appearanceDict.getArrayValue(DictKey.Matrix), IDENTITY_MATRIX
    );
    const transform = getTransformMatrix(rect, bbox, matrix);

    const opList = new OperatorList();

    let optionalContent;
    if (this.oc) {
      optionalContent = await evaluator.parseMarkedContentProps(this.oc, null);
    }
    if (optionalContent !== undefined) {
      opList.addOp(OPS.beginMarkedContentProps, ["OC", optionalContent]);
    }

    opList.addOp(OPS.beginAnnotation, [id, rect, transform, matrix, isUsingOwnCanvas]);

    await evaluator.getOperatorList(appearance, task, resources!, opList, null, this._fallbackFontDict);

    opList.addOp(OPS.endAnnotation, []);

    if (optionalContent !== undefined) {
      opList.addOp(OPS.endMarkedContent, []);
    }
    this.reset();
    return { opList, separateForm: false, separateCanvas: isUsingOwnCanvas };
  }

  async save(
    _evaluator: PartialEvaluator,
    _task: WorkerTask,
    _annotationStorage: Map<string, AnnotationEditorSerial> | null
  ): Promise<AnnotationSaveRef[] | null> {
    return null;
  }

  get hasTextContent() {
    return false;
  }

  async extractTextContent(evaluator: PartialEvaluator, task: WorkerTask, viewBox: RectType): Promise<void> {
    if (!this.appearance) {
      return;
    }

    const resources = await this.loadResources(
      ["ExtGState", "Font", "Properties", "XObject"], this.appearance
    );

    const text: string[] = [];
    const buffer: string[] = [];
    let firstPosition: PointType | null = null;

    const sink: StreamSink<EvaluatorTextContent> = {

      desiredSize: Infinity,

      ready: Promise.resolve(),

      enqueue(chunk, _size: number) {
        for (const item of chunk.items) {
          if (!isFullTextContentItem(item)) {
            continue;
          }
          firstPosition ||= <PointType>item.transform!.slice(-2);
          buffer.push(item.str);
          if (item.hasEOL) {
            text.push(buffer.join("").trimEnd());
            buffer.length = 0;
          }
        }
      },
      close: () => { },
      error: (_reason: any) => { },
      onPull: null,
      onCancel: null,
      sinkCapability: null,
      isCancelled: false
    };

    await evaluator.getTextContent(
      this.appearance, task, resources as Dict | null, sink, viewBox, true, true
    );

    this.reset();

    if (buffer.length) {
      text.push(buffer.join("").trimEnd());
    }

    if (text.length > 1 || text[0]) {
      const appearanceDict = this.appearance.dict;
      const bbox = lookupRect(appearanceDict!.getArrayValue(DictKey.BBox), null)!;
      const matrix = lookupMatrix(appearanceDict!.getArrayValue(DictKey.Matrix), null)!;

      this.data.textPosition = this._transformPoint(
        firstPosition!, bbox, matrix
      );
      this.data.textContent = text;
    }
  }

  _transformPoint(coords: PointType, bbox: RectType, matrix: TransformType) {
    const rect = this.data.rect!;
    bbox ||= [0, 0, 1, 1];
    matrix ||= [1, 0, 0, 1, 0, 0];
    const transform = getTransformMatrix(rect, bbox, matrix);
    transform[4] -= rect[0];
    transform[5] -= rect[1];
    coords = Util.applyTransform(coords, transform);
    return Util.applyTransform(coords, matrix);
  }

  /**
   * Get field data for usage in JS sandbox.
   *
   * Field object is defined here:
   * https://www.adobe.com/content/dam/acom/en/devnet/acrobat/pdfs/js_api_reference.pdf#page=16
   *
   * @public
   * @memberof Annotation
   * @returns {Object | null}
   */
  getFieldObject(): FieldObject | null {
    if (this.data.kidIds) {
      return <DefaultFieldObject>{
        id: this.data.id,
        actions: this.data.actions!,
        name: this.data.fieldName!,
        strokeColor: this.data.borderColor,
        fillColor: this.data.backgroundColor,
        type: "",
        kidIds: this.data.kidIds,
        page: this.data.pageIndex!,
        rotation: this.rotation,
      };
    }
    return null;
  }

  /**
   * Reset the annotation.
   *
   * This involves resetting the various streams that are either cached on the
   * annotation instance or created during its construction.
   *
   * @public
   * @memberof Annotation
   */
  reset() {
    if ((PlatformHelper.isTesting()) &&
      this.appearance &&
      !this._streams.includes(this.appearance)
    ) {
      unreachable("The appearance stream should always be reset.");
    }

    for (const stream of this._streams) {
      stream.reset();
    }
  }

  /**
   * Construct the (fully qualified) field name from the (partial) field
   * names of the field and its ancestors.
   *
   * @private
   * @memberof Annotation
   * @param {Dict} dict - Complete widget annotation dictionary
   * @returns {string}
   */
  _constructFieldName(dict: Dict) {
    // Both the `Parent` and `T` fields are optional. While at least one of
    // them should be provided, bad PDF generators may fail to do so.
    if (!dict.has(DictKey.T) && !dict.has(DictKey.Parent)) {
      warn("Unknown field name, falling back to empty field name.");
      return "";
    }

    // If no parent exists, the partial and fully qualified names are equal.
    if (!dict.has(DictKey.Parent)) {
      return stringToPDFString(<string>dict.getValue(DictKey.T));
    }

    // Form the fully qualified field name by appending the partial name to
    // the parent's fully qualified name, separated by a period.
    const fieldName = [];
    if (dict.has(DictKey.T)) {
      fieldName.unshift(stringToPDFString(<string>dict.getValue(DictKey.T)));
    }

    let loopDict: Dict | Ref = dict;
    const visited = new RefSet();
    if (dict.objId) {
      visited.put(dict.objId);
    }
    while ((<Dict>loopDict).has(DictKey.Parent)) {
      loopDict = (<Dict>loopDict).getValue(DictKey.Parent);
      if (
        !(loopDict instanceof DictImpl) ||
        (loopDict.objId && visited.has(loopDict.objId))
      ) {
        // Even though it is not allowed according to the PDF specification,
        // bad PDF generators may provide a `Parent` entry that is not a
        // dictionary, but `null` for example (issue 8143).
        //
        // If parent has been already visited, it means that we're
        // in an infinite loop.
        break;
      }
      if (loopDict.objId) {
        visited.put(loopDict.objId);
      }

      if (loopDict.has(DictKey.T)) {
        fieldName.unshift(stringToPDFString(<string>loopDict.getValue(DictKey.T)));
      }
    }
    return fieldName.join(".");
  }
}

/**
 * Contains all data regarding an annotation's border style.
 */
export class AnnotationBorderStyle {

  public width: number;

  public horizontalCornerRadius: number;

  public verticalCornerRadius: number;

  public style: number;

  public rawWidth: number;

  protected dashArray: number[];

  constructor() {
    this.width = 1;
    this.rawWidth = 1;
    this.style = AnnotationBorderStyleType.SOLID;
    this.dashArray = [3];
    this.horizontalCornerRadius = 0;
    this.verticalCornerRadius = 0;
  }

  noBorder() {
    this.width = 0;
    this.rawWidth = 0;
    this.dashArray = [];
    return this;
  }

  /**
   * Set the width.
   *
   * @public
   * @memberof AnnotationBorderStyle
   * @param width - The width.
   * @param rect - The annotation `Rect` entry.
   */
  setWidth(width: number | Name, rect: RectType = [0, 0, 0, 0]) {
    if (PlatformHelper.isTesting()) {
      assert(
        isNumberArray(rect, 4),
        "A valid `rect` parameter must be provided."
      );
    }

    // Some corrupt PDF generators may provide the width as a `Name`,
    // rather than as a number (fixes issue 10385).
    if (width instanceof Name) {
      this.width = 0; // This is consistent with the behaviour in Adobe Reader.
      return;
    }
    if (typeof width === "number") {
      if (width > 0) {
        this.rawWidth = width;
        const maxWidth = (rect[2] - rect[0]) / 2;
        const maxHeight = (rect[3] - rect[1]) / 2;

        // Ignore large `width`s, since they lead to the Annotation overflowing
        // the size set by the `Rect` entry thus causing the `annotationLayer`
        // to render it over the surrounding document (fixes bug1552113.pdf).
        if (
          maxWidth > 0 &&
          maxHeight > 0 &&
          (width > maxWidth || width > maxHeight)
        ) {
          warn(`AnnotationBorderStyle.setWidth - ignoring width: ${width}`);
          width = 1;
        }
      }
      this.width = width;
    }
  }

  /**
   * Set the style.
   *
   * @public
   * @memberof AnnotationBorderStyle
   * @param {Name} style - The annotation style.
   * @see {@link shared/util.ts}
   */
  setStyle(style: Name) {
    if (!(style instanceof Name)) {
      return;
    }
    switch (style.name) {
      case "S":
        this.style = AnnotationBorderStyleType.SOLID;
        break;

      case "D":
        this.style = AnnotationBorderStyleType.DASHED;
        break;

      case "B":
        this.style = AnnotationBorderStyleType.BEVELED;
        break;

      case "I":
        this.style = AnnotationBorderStyleType.INSET;
        break;

      case "U":
        this.style = AnnotationBorderStyleType.UNDERLINE;
        break;

      default:
        break;
    }
  }

  /**
   * Set the dash array.
   *
   * @public
   * @memberof AnnotationBorderStyle
   * @param dashArray - The dash array with at least one element
   * @param forceStyle
   */
  setDashArray(dashArray: number[], forceStyle = false) {
    // We validate the dash array, but we do not use it because CSS does not
    // allow us to change spacing of dashes. For more information, visit
    // http://www.w3.org/TR/css3-background/#the-border-style.
    if (Array.isArray(dashArray)) {
      // The PDF specification states that elements in the dash array, if
      // present, must be non-negative numbers and must not all equal zero.
      let isValid = true;
      let allZeros = true;
      for (const element of dashArray) {
        const validNumber = +element >= 0;
        if (!validNumber) {
          isValid = false;
          break;
        } else if (element > 0) {
          allZeros = false;
        }
      }
      if (dashArray.length === 0 || (isValid && !allZeros)) {
        this.dashArray = dashArray;

        if (forceStyle) {
          // Even though we cannot use the dash array in the display layer,
          // at least ensure that we use the correct border-style.
          this.setStyle(Name.get("D")!);
        }
      } else {
        this.width = 0; // Adobe behavior when the array is invalid.
      }
    } else if (dashArray) {
      this.width = 0; // Adobe behavior when the array is invalid.
    }
  }

  /**
   * Set the horizontal corner radius (from a Border dictionary).
   *
   * @public
   * @memberof AnnotationBorderStyle
   * @param {number} radius - The horizontal corner radius.
   */
  setHorizontalCornerRadius(radius: number) {
    if (Number.isInteger(radius)) {
      this.horizontalCornerRadius = radius;
    }
  }

  /**
   * Set the vertical corner radius (from a Border dictionary).
   *
   * @public
   * @memberof AnnotationBorderStyle
   * @param {number} radius - The vertical corner radius.
   */
  setVerticalCornerRadius(radius: number) {
    if (Number.isInteger(radius)) {
      this.verticalCornerRadius = radius;
    }
  }
}

export interface MarkupData extends AnnotationData {
  replyType: string;
  inReplyTo: string | null;
  titleObj: StringObj;
  creationDate: string | null;
}

export class MarkupAnnotation<T extends MarkupData> extends Annotation<T> {

  protected creationDate: string | null = null;

  constructor(params: AnnotationParameters) {
    super(params);

    const { dict } = params;

    if (dict.has(DictKey.IRT)) {
      const rawIRT = dict.getRaw(DictKey.IRT);
      this.data.inReplyTo = rawIRT instanceof Ref ? rawIRT.toString() : null;

      const rt = dict.getValue(DictKey.RT);
      this.data.replyType = rt instanceof Name ? rt.name : AnnotationReplyType.REPLY;
    }
    let popupRef = null;

    if (this.data.replyType === AnnotationReplyType.GROUP) {
      // Subordinate annotations in a group should inherit
      // the group attributes from the primary annotation.
      const parent = <Dict>dict.getValue(DictKey.IRT);

      this.setTitle(<string>parent.getValue(DictKey.T));
      this.data.titleObj = this._title;

      this.setContents(parent.getValue(DictKey.Contents));
      this.data.contentsObj = this._contents;

      if (!parent.has(DictKey.CreationDate)) {
        this.data.creationDate = null;
      } else {
        this.setCreationDate(parent.getValue(DictKey.CreationDate));
        this.data.creationDate = this.creationDate;
      }

      if (!parent.has(DictKey.M)) {
        this.data.modificationDate = null;
      } else {
        this.setModificationDate(parent.getValue(DictKey.M));
        this.data.modificationDate = this.modificationDate;
      }

      popupRef = parent.getRaw(DictKey.Popup);

      if (!parent.has(DictKey.C)) {
        // Fall back to the default background color.
        this.data.color = null;
      } else {
        this.setColor(parent.getArrayValue(DictKey.C));
        this.data.color = this.color;
      }
    } else {
      this.data.titleObj = this._title;

      this.setCreationDate(dict.getValue(DictKey.CreationDate));
      this.data.creationDate = this.creationDate;

      popupRef = dict.getRaw(DictKey.Popup);

      if (!dict.has(DictKey.C)) {
        // Fall back to the default background color.
        this.data.color = null;
      }
    }

    this.data.popupRef = popupRef instanceof Ref ? popupRef.toString() : null;
  }

  /**
   * Set the creation date.
   *
   * @public
   * @memberof MarkupAnnotation
   * @param {string} creationDate - PDF date string that indicates when the
   *                                annotation was originally created
   */
  setCreationDate(creationDate: string) {
    this.creationDate = typeof creationDate === "string" ? creationDate : null;
  }

  _setDefaultAppearance(
    xref: XRefImpl,
    extra: string | null,
    strokeColor: number[] | null,
    fillColor: number[] | null,
    blendMode: string | null,
    strokeAlpha: number | null,
    fillAlpha: number | null,
    pointsCallback: (buf: string[], points: Float32Array) => RectType
  ) {
    let minX = Number.MAX_VALUE;
    let minY = Number.MAX_VALUE;
    let maxX = Number.MIN_VALUE;
    let maxY = Number.MIN_VALUE;

    const buffer = ["q"];
    if (extra) {
      buffer.push(extra);
    }
    if (strokeColor) {
      buffer.push(`${strokeColor[0]} ${strokeColor[1]} ${strokeColor[2]} RG`);
    }
    if (fillColor) {
      buffer.push(`${fillColor[0]} ${fillColor[1]} ${fillColor[2]} rg`);
    }

    let pointsArray = this.data.quadPoints;
    if (!pointsArray) {
      // If there are no quadpoints, the rectangle should be used instead.
      // Convert the rectangle definition to a points array similar to how the
      // quadpoints are defined.
      pointsArray = Float32Array.from([
        this.rectangle[0],
        this.rectangle[3],
        this.rectangle[2],
        this.rectangle[3],
        this.rectangle[0],
        this.rectangle[1],
        this.rectangle[2],
        this.rectangle[1],
      ]);
    }

    for (let i = 0, ii = pointsArray.length; i < ii; i += 8) {
      const [mX, MX, mY, MY] = pointsCallback(
        buffer,
        pointsArray.subarray(i, i + 8)
      );
      minX = Math.min(minX, mX);
      maxX = Math.max(maxX, MX);
      minY = Math.min(minY, mY);
      maxY = Math.max(maxY, MY);
    }
    buffer.push("Q");

    const formDict = new DictImpl(xref);
    const appearanceStreamDict = new DictImpl(xref);
    appearanceStreamDict.set(DictKey.Subtype, Name.get("Form"));

    const appearanceStream = new StringStream(buffer.join(" "));
    appearanceStream.dict = appearanceStreamDict;
    formDict.set(DictKey.Fm0, appearanceStream);

    const gsDict = new DictImpl(xref);
    if (blendMode) {
      gsDict.set(DictKey.BM, Name.get(blendMode)!);
    }
    if (typeof strokeAlpha === "number") {
      gsDict.set(DictKey.CA, strokeAlpha);
    }
    if (typeof fillAlpha === "number") {
      gsDict.set(DictKey.ca, fillAlpha);
    }

    const stateDict = new DictImpl(xref);
    stateDict.set(DictKey.GS0, gsDict);

    const resources = new DictImpl(xref);
    resources.set(DictKey.ExtGState, stateDict);
    resources.set(DictKey.XObject, formDict);

    const appearanceDict = new DictImpl(xref);
    appearanceDict.set(DictKey.Resources, resources);
    const bbox: RectType = (this.data.rect = [minX, minY, maxX, maxY]);
    appearanceDict.set(DictKey.BBox, bbox);

    this.appearance = new StringStream("/GS0 gs /Fm0 Do");
    this.appearance.dict = appearanceDict;

    // This method is only called if there is no appearance for the annotation,
    // so `this.appearance` is not pushed yet in the `Annotation` constructor.
    this._streams.push(this.appearance, appearanceStream);
  }
}

export interface WidgetData extends AnnotationData {
  doNotScroll: boolean;
  maxLen: number;
  textAlignment: number | null;
  comb: boolean;
  multiLine: boolean;
  options: {
    // 这两个值从静态代码分析的角度来看，是有可能是string[]的
    // 但根据代码的具体值来看，发现他们应该还是string类型的。
    exportValue: string | null,
    displayValue: string | null,
  }[] | null;
  combo: boolean | string | null;
  fieldValue: string | string[] | null;
  annotationType: AnnotationType;
  defaultFieldValue: string | string[] | null;
  fieldType: string | null;
  fieldFlags: number;
  hidden: boolean;
  required: boolean;
  readOnly: boolean;
}

interface CacheLine {
  line: string;
  glyphs: Glyph[];
  positions: [number, number][];
}

function newCacheLine(): CacheLine {
  return {
    line: "",
    glyphs: [],
    positions: []
  }
}

export class WidgetAnnotation<T extends WidgetData> extends Annotation<T> {

  protected _hasText: boolean = false;

  protected _fieldResources: {
    localResources: Dict,
    acroFormResources: Dict,
    appearanceResources: Dict,
    mergedResources: Dict
  }

  protected _needAppearances: boolean;

  constructor(params: AnnotationParameters) {
    super(params);

    const { dict, xref, annotationGlobals } = params;
    const data = this.data;
    this._needAppearances = params.needAppearances;

    data.annotationType = AnnotationType.WIDGET;
    if (data.fieldName === undefined) {
      data.fieldName = this._constructFieldName(dict);
    }

    if (data.actions === undefined) {
      data.actions = collectActions(xref, dict, AnnotationActionEventType) ?? undefined;
    }

    let fieldValue = getSingleInheritableProperty(dict, DictKey.V, true);
    data.fieldValue = this._decodeFormValue(fieldValue);

    const defaultFieldValue = getSingleInheritableProperty(dict, DictKey.DV, true);
    data.defaultFieldValue = this._decodeFormValue(defaultFieldValue);


    // When no "V" entry exists, let the fieldValue fallback to the "DV" entry
    // (fixes issue13823.pdf).
    if (fieldValue === undefined && data.defaultFieldValue !== null) {
      data.fieldValue = data.defaultFieldValue;
    }

    data.alternativeText = stringToPDFString(dict.getValue(DictKey.TU) || "");

    this.setDefaultAppearance(params);

    data.hasAppearance ||= this._needAppearances &&
      data.fieldValue !== undefined && data.fieldValue !== null;

    const fieldType = getSingleInheritableProperty(dict, DictKey.FT);
    data.fieldType = fieldType instanceof Name ? fieldType.name : null;

    const localResources = <Dict>getSingleInheritableProperty(dict, DictKey.DR);
    const acroFormResources = annotationGlobals.acroForm.getValue(DictKey.DR);
    const appearanceResources = this.appearance?.dict!.getValue(DictKey.Resources)!;

    this._fieldResources = {
      localResources,
      acroFormResources,
      appearanceResources,
      mergedResources: DictImpl.merge(
        xref, [localResources, appearanceResources, acroFormResources], true,
      ),
    };

    const fieldFlags = getSingleInheritableProperty(dict, DictKey.Ff)!;
    if (!Number.isInteger(fieldFlags) || fieldFlags < 0) {
      data.fieldFlags = 0;
    } else {
      data.fieldFlags = fieldFlags;
    }

    data.combo = null;
    data.readOnly = this.hasFieldFlag(AnnotationFieldFlag.READONLY);
    data.required = this.hasFieldFlag(AnnotationFieldFlag.REQUIRED);
    data.hidden = this._hasFlag(data.annotationFlags, AnnotationFlag.HIDDEN) ||
      this._hasFlag(data.annotationFlags, AnnotationFlag.NOVIEW);
  }

  /**
   * Decode the given form value.
   *
   * @private
   * @memberof WidgetAnnotation
   * @param {Array<string>|Name|string} formValue - The (possibly encoded)
   *   form value.
   * @returns {Array<string>|string|null}
   */
  _decodeFormValue(formValue: string[] | Name | string | unknown): string | string[] | null {
    if (Array.isArray(formValue)) {
      return (formValue as string[]).filter(item => typeof item === "string")
        .map(item => stringToPDFString(item));
    } else if (formValue instanceof Name) {
      return stringToPDFString(formValue.name);
    } else if (typeof formValue === "string") {
      return stringToPDFString(formValue);
    }
    return null;
  }

  /**
   * Check if a provided field flag is set.
   *
   * @public
   * @memberof WidgetAnnotation
   * @param flag - Hexadecimal representation for an annotation
   *                        field characteristic
   * @see {@link ../shared/util.ts}
   */
  hasFieldFlag(flag: number): boolean {
    return !!(this.data.fieldFlags! & flag);
  }

  /** @inheritdoc */
  _isViewable(_flags: number) {
    // We don't take into account the `NOVIEW` or `HIDDEN` flags here,
    // since the visibility can be changed by js code, hence in case
    // it's made viewable, we should render it (with visibility set to
    // hidden).
    // We don't take into account the `INVISIBLE` flag here, since we've a known
    // annotation type.
    return true;
  }

  /** @inheritdoc */
  mustBeViewed(annotationStorage: Map<string, Record<string, any>> | null, renderForms: boolean) {
    if (renderForms) {
      return this.viewable;
    }
    return (
      super.mustBeViewed(annotationStorage, renderForms) &&
      !this._hasFlag(this.flags, AnnotationFlag.NOVIEW)
    );
  }

  getRotationMatrix(annotationStorage: Map<string, Record<string, any>> | null) {
    let rotation = annotationStorage?.get(this.data.id)?.rotation;
    if (rotation === undefined) {
      rotation = this.rotation;
    }

    if (rotation === 0) {
      return IDENTITY_MATRIX;
    }

    const width = this.data.rect![2] - this.data.rect![0];
    const height = this.data.rect![3] - this.data.rect![1];

    return getRotationMatrix(rotation, width, height);
  }

  getBorderAndBackgroundAppearances(annotationStorage: Map<string, AnnotationEditorSerial> | null) {
    let rotation = (<{ rotation?: number }>annotationStorage?.get(this.data.id))?.rotation;
    if (rotation === undefined) {
      rotation = this.rotation;
    }

    if (!this.backgroundColor && !this.borderColor) {
      return "";
    }
    const width = this.data.rect![2] - this.data.rect![0];
    const height = this.data.rect![3] - this.data.rect![1];
    const rect = rotation === 0 || rotation === 180
      ? `0 0 ${width} ${height} re`
      : `0 0 ${height} ${width} re`;

    let str = "";
    if (this.backgroundColor) {
      str = `${getPdfColor(
        this.backgroundColor,
        /* isFill */ true
      )} ${rect} f `;
    }

    if (this.borderColor) {
      const borderWidth = this.borderStyle.width || 1;
      str += `${borderWidth} w ${getPdfColor(
        this.borderColor,
        /* isFill */ false
      )} ${rect} S `;
    }

    return str;
  }

  async getOperatorList(
    evaluator: PartialEvaluator,
    task: WorkerTask,
    intent: number,
    annotationStorage: Map<string, AnnotationEditorSerial> | null
  ) {
    // Do not render form elements on the canvas when interactive forms are
    // enabled. The display layer is responsible for rendering them instead.
    if (
      intent & RenderingIntentFlag.ANNOTATIONS_FORMS &&
      !(this instanceof SignatureWidgetAnnotation) &&
      !this.data.noHTML &&
      !this.data.hasOwnCanvas
    ) {
      return {
        opList: new OperatorList(),
        separateForm: true,
        separateCanvas: false,
      };
    }

    if (!this._hasText) {
      return super.getOperatorList(evaluator, task, intent, annotationStorage);
    }

    const content = await this._getAppearance(
      evaluator, task, intent, annotationStorage
    );
    if (this.appearance && content === null) {
      return super.getOperatorList(evaluator, task, intent, annotationStorage);
    }

    const opList = new OperatorList();

    // Even if there is an appearance stream, ignore it. This is the
    // behaviour used by Adobe Reader.
    if (!this._defaultAppearance || content === null) {
      return { opList, separateForm: false, separateCanvas: false };
    }

    const isUsingOwnCanvas = !!(
      this.data.hasOwnCanvas && intent & RenderingIntentFlag.DISPLAY
    );

    const matrix: TransformType = [1, 0, 0, 1, 0, 0];
    const bbox: RectType = [
      0,
      0,
      this.data.rect![2] - this.data.rect![0],
      this.data.rect![3] - this.data.rect![1],
    ];
    const transform = getTransformMatrix(this.data.rect!, bbox, matrix);

    let optionalContent;
    if (this.oc) {
      optionalContent = await evaluator.parseMarkedContentProps(this.oc, null);
    }
    if (optionalContent !== undefined) {
      opList.addOp(OPS.beginMarkedContentProps, ["OC", optionalContent]);
    }

    opList.addOp(OPS.beginAnnotation, [
      this.data.id,
      this.data.rect,
      transform,
      this.getRotationMatrix(annotationStorage),
      isUsingOwnCanvas,
    ]);

    const stream = new StringStream(<string>content);
    await evaluator.getOperatorList(
      stream,
      task,
      this._fieldResources.mergedResources,
      opList,
    );
    opList.addOp(OPS.endAnnotation, []);

    if (optionalContent !== undefined) {
      opList.addOp(OPS.endMarkedContent, []);
    }
    return { opList, separateForm: false, separateCanvas: isUsingOwnCanvas };
  }

  _getMKDict(rotation: number) {
    const mk = new DictImpl(null);
    if (rotation) {
      mk.set(DictKey.R, rotation);
    }
    if (this.borderColor) {
      mk.set(DictKey.BC, getPdfColorArray(this.borderColor));
    }
    if (this.backgroundColor) {
      mk.set(DictKey.BG, getPdfColorArray(this.backgroundColor));
    }
    return mk.size > 0 ? mk : null;
  }

  amendSavedDict(_annotationStorage: Map<string, AnnotationEditorSerial> | null, _dict: Dict) { }

  async save(
    evaluator: PartialEvaluator,
    task: WorkerTask,
    annotationStorage: Map<string, AnnotationEditorSerial> | null
  ): Promise<AnnotationSaveRef[] | null> {
    interface MaybeType {
      noView?: boolean,
      noPrint?: boolean,
      value?: string | string[],
      rotation?: number
    }
    const storageEntry = <MaybeType>annotationStorage?.get(this.data.id);
    const flags = this._buildFlags(storageEntry?.noView, storageEntry?.noPrint);
    let value = storageEntry ? storageEntry.value : null;
    let rotation = storageEntry ? storageEntry.rotation : null;
    if (value === this.data.fieldValue || value === null) {
      if (rotation === null && flags === null) {
        return null;
      }
      value ||= this.data.fieldValue;
    }

    // Value can be an array (with choice list and multiple selections)
    if (rotation === null && Array.isArray(value) && Array.isArray(this.data.fieldValue) &&
      isArrayEqual(value, this.data.fieldValue) && flags === null
    ) {
      return null;
    }

    if (rotation === null) {
      rotation = this.rotation;
    }

    let appearance = null;
    if (!this._needAppearances) {
      appearance = await this._getAppearance(
        evaluator, task, RenderingIntentFlag.SAVE, annotationStorage
      );
      if (appearance === null && flags === null) {
        // Appearance didn't change.
        return null;
      }
    } else {
      // No need to create an appearance: the pdf has the flag /NeedAppearances
      // which means that it's up to the reader to produce an appearance.
    }

    let needAppearances = false;
    if ((<{ needAppearances: boolean; }>appearance)?.needAppearances) {
      needAppearances = true;
      appearance = null;
    }

    const { xref } = evaluator;

    const originalDict = xref.fetchIfRef(this.ref!);
    if (!(originalDict instanceof DictImpl)) {
      return null;
    }

    const dict = new DictImpl(xref);
    for (const key of originalDict.getKeys()) {
      if (key !== DictKey.AP) {
        dict.set(key, <unknown>originalDict.getRaw(key));
      }
    }
    if (flags !== undefined) {
      dict.set(DictKey.F, flags!);
      if (appearance === null && !needAppearances) {
        const ap = originalDict.getRaw(DictKey.AP);
        if (ap) {
          dict.set(DictKey.AP, ap);
        }
      }
    }

    dict.set(DictKey.V, Array.isArray(value) ? value.map(stringToAsciiOrUTF16BE) : stringToAsciiOrUTF16BE(value!));
    this.amendSavedDict(annotationStorage, dict);

    const maybeMK = this._getMKDict(rotation!);
    if (maybeMK) {
      dict.set(DictKey.MK, maybeMK);
    }

    const buffer: string[] = [];
    const changes = [
      // data for the original object
      // V field changed + reference for new AP
      { ref: this.ref, data: "", needAppearances },
    ];
    if (appearance !== null) {
      const newRef = xref.getNewTemporaryRef();
      const AP = new DictImpl(xref);
      dict.set(DictKey.AP, AP);
      AP.set(DictKey.N, newRef);

      const resources = this._getSaveFieldResources(xref);
      const appearanceStream = new StringStream(<string>appearance);
      const appearanceDict = (appearanceStream.dict = new DictImpl(xref));
      appearanceDict.set(DictKey.Subtype, Name.get("Form"));
      appearanceDict.set(DictKey.Resources, resources);
      appearanceDict.set(DictKey.BBox, [
        0, 0, this.data.rect![2] - this.data.rect![0], this.data.rect![3] - this.data.rect![1],
      ]);

      const rotationMatrix = this.getRotationMatrix(annotationStorage);
      if (rotationMatrix !== IDENTITY_MATRIX) {
        // The matrix isn't the identity one.
        appearanceDict.set(DictKey.Matrix, rotationMatrix);
      }

      await writeObject(newRef, appearanceStream, buffer, xref.encrypt);

      // data for the new AP
      changes.push({ ref: newRef, data: buffer.join(""), needAppearances: false });
      buffer.length = 0;
    }

    dict.set(DictKey.M, `D:${getModificationDate()}`);
    await writeObject(this.ref!, dict, buffer, xref.encrypt);

    changes[0].data = buffer.join("");

    return changes;
  }

  async _getAppearance(
    evaluator: PartialEvaluator,
    task: WorkerTask,
    intent: number,
    annotationStorage: Map<string, AnnotationEditorSerial> | null
  ) {
    const isPassword = this.hasFieldFlag(AnnotationFieldFlag.PASSWORD);
    if (isPassword) {
      return null;
    }
    interface MaybeType {
      formattedValue: string | string[];
      value: string | string[];
      rotation: number;
    }
    const storageEntry = <MaybeType | undefined>annotationStorage?.get(this.data.id);
    let value, rotation;
    if (storageEntry) {
      value = storageEntry.formattedValue || storageEntry.value;
      rotation = storageEntry.rotation;
    }

    if (rotation === undefined && value === undefined && !this._needAppearances) {
      if (this.appearance) {
        // The annotation hasn't been rendered so use the appearance.
        return null;
      }
    }

    // Empty or it has a trailing whitespace.
    const colors = this.getBorderAndBackgroundAppearances(annotationStorage);

    if (value === undefined) {
      // The annotation has its value in XFA datasets but not in the V field.
      value = this.data.fieldValue;
      if (!value) {
        return `/Tx BMC q ${colors}Q EMC`;
      }
    }

    if (Array.isArray(value) && value.length === 1) {
      value = value[0];
    }

    assert(typeof value === "string", "Expected `value` to be a string.");
    let strVal = value.trimEnd();

    if (this.data.combo) {
      // The value can be one of the exportValue or any other values.
      const option = this.data.options!.find(
        ({ exportValue }) => strVal === exportValue
      );
      strVal = option?.displayValue || strVal;
    }

    if (strVal === "") {
      // the field is empty: nothing to render
      return `/Tx BMC q ${colors}Q EMC`;
    }

    if (rotation === undefined) {
      rotation = this.rotation;
    }

    let lineCount = -1;
    let lines;

    // We could have a text containing for example some sequences of chars and
    // their diacritics (e.g. "é".normalize("NFKD") shows 1 char when it's 2).
    // Positioning diacritics is really something we don't want to do here.
    // So if a font has a glyph for a acute accent and one for "e" then we won't
    // get any encoding issues but we'll render "e" and then "´".
    // It's why we normalize the string. We use NFC to preserve the initial
    // string, (e.g. "²".normalize("NFC") === "²"
    // but "²".normalize("NFKC") === "2").
    //
    // TODO: it isn't a perfect solution, some chars like "ẹ́" will be
    // decomposed into two chars ("ẹ" and "´"), so we should detect such
    // situations and then use either FakeUnicodeFont or set the
    // /NeedAppearances flag.
    if (this.data.multiLine) {
      lines = strVal.split(/\r\n?|\n/).map(line => line.normalize("NFC"));
      lineCount = lines.length;
    } else {
      lines = [strVal.replace(/\r\n?|\n/, "").normalize("NFC")];
    }

    const defaultPadding = 1;
    const defaultHPadding = 2;
    let totalHeight = this.data.rect![3] - this.data.rect![1];
    let totalWidth = this.data.rect![2] - this.data.rect![0];

    if (rotation === 90 || rotation === 270) {
      [totalWidth, totalHeight] = [totalHeight, totalWidth];
    }

    if (!this._defaultAppearance) {
      // The DA is required and must be a string.
      // If there is no font named Helvetica in the resource dictionary,
      // the evaluator will fall back to a default font.
      // Doing so prevents exceptions and allows saving/printing
      // the file as expected.
      this.data.defaultAppearanceData = parseDefaultAppearance(
        (this._defaultAppearance = "/Helvetica 0 Tf 0 g")
      );
    }

    let font = await WidgetAnnotation._getFontData(
      evaluator,
      task,
      this.data.defaultAppearanceData!,
      this._fieldResources.mergedResources
    );

    let defaultAppearance: string, fontSize: number, lineHeight: number;
    const encodedLines = [];
    let encodingError = false;
    for (const line of lines) {
      const encodedString = font!.encodeString(line);
      if (encodedString.length > 1) {
        encodingError = true;
      }
      encodedLines.push(encodedString.join(""));
    }

    if (encodingError && intent & RenderingIntentFlag.SAVE) {
      // We don't have a way to render the field, so we just rely on the
      // /NeedAppearances trick to let the different sofware correctly render
      // this pdf.
      return { needAppearances: true };
    }

    // We check that the font is able to encode the string.
    if (encodingError && this._isOffscreenCanvasSupported) {
      // If it can't then we fallback on fake unicode font (mapped to sans-serif
      // for the rendering).
      // It means that a printed form can be rendered differently (it depends on
      // the sans-serif font) but at least we've something to render.
      // In an ideal world the associated font should correctly handle the
      // possible chars but a user can add a smiley or whatever.
      // We could try to embed a font but it means that we must have access
      // to the raw font file.
      const fontFamily = this.data.comb ? "monospace" : "sans-serif";
      const fakeUnicodeFont = new FakeUnicodeFont(evaluator.xref, fontFamily);
      const resources = fakeUnicodeFont.createFontResources(lines.join(""));
      const newFont = <Dict>resources.getRaw(DictKey.Font);

      if (this._fieldResources.mergedResources.has(DictKey.Font)) {
        const oldFont = <Dict>this._fieldResources.mergedResources.getValue(DictKey.Font);
        for (const key of newFont.getKeys()) {
          oldFont.set(key, newFont.getRaw(key));
        }
      } else {
        this._fieldResources.mergedResources.set(DictKey.Font, newFont);
      }

      const fontName = fakeUnicodeFont.fontName.name;
      font = await WidgetAnnotation._getFontData(
        evaluator, task, { fontName, fontSize: 0 }, resources
      );

      for (let i = 0, ii = encodedLines.length; i < ii; i++) {
        encodedLines[i] = stringToUTF16String(lines[i]);
      }

      const savedDefaultAppearance = Object.assign(
        Object.create(null), this.data.defaultAppearanceData
      );
      this.data.defaultAppearanceData!.fontSize = 0;
      this.data.defaultAppearanceData!.fontName = fontName;

      [defaultAppearance, fontSize, lineHeight] = this._computeFontSize(
        totalHeight - 2 * defaultPadding, totalWidth - 2 * defaultHPadding, strVal, font!, lineCount
      );

      this.data.defaultAppearanceData = savedDefaultAppearance;
    } else {
      if (!this._isOffscreenCanvasSupported) {
        warn("_getAppearance: OffscreenCanvas is not supported, annotation may not render correctly.");
      }

      [defaultAppearance, fontSize, lineHeight] = this._computeFontSize(
        totalHeight - 2 * defaultPadding, totalWidth - 2 * defaultHPadding, strVal, font!, lineCount
      );
    }

    let descent = font!.descent;
    if (isNaN(descent!)) {
      descent = BASELINE_FACTOR * lineHeight;
    } else {
      descent = Math.max(
        BASELINE_FACTOR * lineHeight,
        Math.abs(descent!) * fontSize
      );
    }

    // Take into account the space we have to compute the default vertical
    // padding.
    const defaultVPadding = Math.min(
      Math.floor((totalHeight - fontSize) / 2),
      defaultPadding
    );
    const alignment = this.data.textAlignment;

    if (this.data.multiLine) {
      return this._getMultilineAppearance(
        defaultAppearance,
        encodedLines,
        <Font>font,
        fontSize,
        totalWidth,
        totalHeight,
        alignment,
        defaultHPadding,
        defaultVPadding,
        descent,
        lineHeight,
        annotationStorage
      );
    }

    if (this.data.comb) {
      return this._getCombAppearance(
        defaultAppearance,
        <Font>font,
        encodedLines[0],
        fontSize,
        totalWidth,
        totalHeight,
        defaultHPadding,
        defaultVPadding,
        descent,
        lineHeight,
        annotationStorage
      );
    }

    const bottomPadding = defaultVPadding + descent;
    if (alignment === 0 || alignment! > 2) {
      // Left alignment: nothing to do
      return (
        `/Tx BMC q ${colors}BT ` +
        defaultAppearance +
        ` 1 0 0 1 ${numberToString(defaultHPadding)} ${numberToString(
          bottomPadding
        )} Tm (${escapeString(encodedLines[0])}) Tj` +
        " ET Q EMC"
      );
    }

    const prevInfo = { shift: 0 };
    const renderedText = this._renderText(
      encodedLines[0], font!, fontSize, totalWidth, alignment!, prevInfo, defaultHPadding, bottomPadding
    );
    return (
      `/Tx BMC q ${colors}BT ` +
      defaultAppearance +
      ` 1 0 0 1 0 0 Tm ${renderedText}` +
      " ET Q EMC"
    );
  }

  static async _getFontData(evaluator: PartialEvaluator, task: WorkerTask, appearanceData: { fontName: string, fontSize: number }, resources: Dict) {
    const operatorList = new OperatorList();
    const initialState = {
      font: <Font | ErrorFont | null>null,
      clone() {
        return this;
      },
    };

    const { fontName, fontSize } = appearanceData;

    await evaluator.handleSetFont(
      resources,
      [fontName && Name.get(fontName)!, fontSize],
      /* fontRef = */ null,
      operatorList,
      task,
      initialState,
      /* fallbackFontDict = */ null
    );

    return initialState.font;
  }

  _getTextWidth(text: string, font: Font | ErrorFont) {
    return (font.charsToGlyphs(text).reduce((width, glyph) => width + glyph.width, 0) / 1000);
  }

  _computeFontSize(height: number, width: number, text: string, font: Font | ErrorFont, lineCount: number): [string, number, number] {
    let { fontSize } = this.data.defaultAppearanceData!;
    let lineHeight = (fontSize || 12) * LINE_FACTOR,
      numberOfLines = Math.round(height / lineHeight);

    if (!fontSize) {
      // A zero value for size means that the font shall be auto-sized:
      // its size shall be computed as a function of the height of the
      // annotation rectangle (see 12.7.3.3).

      const roundWithTwoDigits = (x: number) => Math.floor(x * 100) / 100;

      if (lineCount === -1) {
        // Get the text width for a font size of 1.
        const textWidth = this._getTextWidth(text, font);

        // width / textWidth is the max font size to fit the width.
        // height / LINE_FACTOR is the max font size to fit the height.
        fontSize = roundWithTwoDigits(
          Math.min(height / LINE_FACTOR, width / textWidth)
        );
        numberOfLines = 1;
      } else {
        const lines = text.split(/\r\n?|\n/);
        const cachedLines: CacheLine[] = [];
        for (const line of lines) {
          const encoded = font.encodeString(line).join("");
          const glyphs = font.charsToGlyphs(encoded);
          const positions = (<Font>font).getCharPositions(encoded);
          cachedLines.push({ line: encoded, glyphs, positions });
        }

        const isTooBig = (fsize: number) => {
          // Return true when the text doesn't fit the given height.
          let totalHeight = 0;
          for (const cache of cachedLines) {
            const chunks = this._splitLine(null, <Font>font, fsize, width, cache);
            totalHeight += chunks.length * fsize;
            if (totalHeight > height) {
              return true;
            }
          }
          return false;
        };

        // Hard to guess how many lines there are.
        // The field may have been sized to have 10 lines
        // and the user entered only 1 so if we get font size from
        // height and number of lines then we'll get something too big.
        // So we compute a fake number of lines based on height and
        // a font size equal to 12 (this is the default font size in
        // Acrobat).
        // Then we'll adjust font size to what we have really.
        numberOfLines = Math.max(numberOfLines, lineCount);

        while (true) {
          lineHeight = height / numberOfLines;
          fontSize = roundWithTwoDigits(lineHeight / LINE_FACTOR);

          if (isTooBig(fontSize)) {
            numberOfLines++;
            continue;
          }

          break;
        }
      }

      const { fontName, fontColor } = this.data.defaultAppearanceData!;
      this._defaultAppearance = createDefaultAppearance(
        fontSize, fontName, fontColor,
      );
    }

    return [this._defaultAppearance, fontSize, height / numberOfLines];
  }

  _renderText(
    text: string,
    font: Font | ErrorFont,
    fontSize: number,
    totalWidth: number,
    alignment: number,
    prevInfo: { shift: number },
    hPadding: number,
    vPadding: number
  ) {
    // TODO: we need to take into account (if possible) how the text
    // is rendered. For example in arabic, the cumulated width of some
    // glyphs isn't equal to the width of the rendered glyphs because
    // of ligatures.
    let shift;
    if (alignment === 1) {
      // Center
      const width = this._getTextWidth(text, font) * fontSize;
      shift = (totalWidth - width) / 2;
    } else if (alignment === 2) {
      // Right
      const width = this._getTextWidth(text, font) * fontSize;
      shift = totalWidth - width - hPadding;
    } else {
      shift = hPadding;
    }
    const shiftStr = numberToString(shift - prevInfo.shift);
    prevInfo.shift = shift;
    const vPaddingStr = numberToString(vPadding);

    return `${shiftStr} ${vPaddingStr} Td (${escapeString(text)}) Tj`;
  }

  /**
   * @private
   */
  _getSaveFieldResources(xref: XRefImpl) {
    if (PlatformHelper.isTesting()) {
      assert(
        !!this.data.defaultAppearanceData,
        "Expected `_defaultAppearanceData` to have been set."
      );
    }
    const { localResources, appearanceResources, acroFormResources } =
      this._fieldResources;

    const fontName = this.data.defaultAppearanceData?.fontName;
    if (!fontName) {
      return localResources || DictImpl.empty;
    }

    for (const resources of [localResources, appearanceResources]) {
      if (resources instanceof DictImpl) {
        const localFont = resources.getValue(DictKey.Font);
        if (localFont instanceof DictImpl && localFont.has(<DictKey>fontName)) {
          return resources;
        }
      }
    }
    if (acroFormResources instanceof DictImpl) {
      const acroFormFont = acroFormResources.getValue(DictKey.Font);
      if (acroFormFont instanceof DictImpl && acroFormFont.has(<DictKey>fontName)) {
        const subFontDict = new DictImpl(xref);
        subFontDict.set(<DictKey>fontName, <any>acroFormFont.getRaw(<DictKey>fontName));

        const subResourcesDict = new DictImpl(xref);
        subResourcesDict.set(DictKey.Font, subFontDict);

        return DictImpl.merge(xref, [subResourcesDict, localResources], true);
      }
    }
    return localResources || DictImpl.empty;
  }

  getFieldObject(): FieldObject | null {
    return null;
  }

  _getMultilineAppearance(
    _defaultAppearance: string,
    _lines: string[],
    _font: Font,
    _fontSize: number,
    _width: number,
    _height: number,
    _alignment: number | null,
    _hPadding: number,
    _vPadding: number,
    _descent: number,
    _lineHeight: number,
    _annotationStorage: Map<string, AnnotationEditorSerial> | null
  ) {
    return "";
  }

  _getCombAppearance(
    _defaultAppearance: string,
    _font: Font | ErrorFont,
    _text: string,
    _fontSize: number,
    _width: number,
    _height: number,
    _hPadding: number,
    _vPadding: number,
    _descent: number,
    _lineHeight: number,
    _annotationStorage: Map<string, AnnotationEditorSerial> | null
  ) {
    return "";
  }

  _splitLine(
    _line: string | null,
    _font: Font,
    _fontSize: number,
    _width: number,
    _cache: CacheLine
  ): string[] {
    return []
  }
}

interface TextWidgetFieldObject extends GeneralFieldObject {
  value: string | string[] | null;
  defaultValue: string | string[];
  multiline: boolean;
  password: boolean;
  charLimit: number;
  comb: boolean;
  editable: boolean;
  hidden: boolean;
  rect: RectType | null;
  actions: Map<string, string[]> | null;
  page: number | null;
  strokeColor: Uint8ClampedArray<ArrayBuffer> | null;
  fillColor: Uint8ClampedArray<ArrayBuffer> | null;
  rotation: number;
  type: string;
}

class TextWidgetAnnotation extends WidgetAnnotation<WidgetData> {

  protected _hasText: boolean;

  constructor(params: AnnotationParameters) {
    super(params);

    const { dict } = params;

    if (dict.has(DictKey.PMD)) {
      // It's used to display a barcode but it isn't specified so we just hide
      // it to avoid any confusion.
      this.flags |= AnnotationFlag.HIDDEN;
      this.data.hidden = true;
      warn("Barcodes are not supported");
    }

    this.data.hasOwnCanvas = (this.data.readOnly && !this.data.noHTML)!;
    this._hasText = true;

    // The field value is always a string.
    if (typeof this.data.fieldValue !== "string") {
      this.data.fieldValue = "";
    }

    // Determine the alignment of text in the field.
    let alignment: number | null = <number>getSingleInheritableProperty(dict, DictKey.Q);
    if (!Number.isInteger(alignment) || alignment < 0 || alignment > 2) {
      alignment = null;
    }
    this.data.textAlignment = alignment;

    // Determine the maximum length of text in the field.
    let maximumLength = <number>getSingleInheritableProperty(dict, DictKey.MaxLen);
    if (!Number.isInteger(maximumLength) || maximumLength < 0) {
      maximumLength = 0;
    }
    this.data.maxLen = maximumLength;

    // Process field flags for the display layer.
    this.data.multiLine = this.hasFieldFlag(AnnotationFieldFlag.MULTILINE);
    this.data.comb =
      this.hasFieldFlag(AnnotationFieldFlag.COMB) &&
      !this.hasFieldFlag(AnnotationFieldFlag.MULTILINE) &&
      !this.hasFieldFlag(AnnotationFieldFlag.PASSWORD) &&
      !this.hasFieldFlag(AnnotationFieldFlag.FILESELECT) &&
      this.data.maxLen !== 0;
    this.data.doNotScroll = this.hasFieldFlag(AnnotationFieldFlag.DONOTSCROLL);
  }

  get hasTextContent() {
    return !!this.appearance && !this._needAppearances;
  }

  _getCombAppearance(
    defaultAppearance: string,
    font: Font,
    text: string,
    _fontSize: number,
    width: number,
    _height: number,
    hPadding: number,
    vPadding: number,
    descent: number,
    _lineHeight: number,
    annotationStorage: Map<string, AnnotationEditorSerial> | null
  ) {
    const combWidth = width / this.data.maxLen!;
    // Empty or it has a trailing whitespace.
    const colors = this.getBorderAndBackgroundAppearances(annotationStorage);

    const buf = [];
    const positions = font.getCharPositions(text);
    for (const [start, end] of positions) {
      buf.push(`(${escapeString(text.substring(start, end))}) Tj`);
    }

    const renderedComb = buf.join(` ${numberToString(combWidth)} 0 Td `);
    return (
      `/Tx BMC q ${colors}BT ` +
      defaultAppearance +
      ` 1 0 0 1 ${numberToString(hPadding)} ${numberToString(
        vPadding + descent
      )} Tm ${renderedComb}` +
      " ET Q EMC"
    );
  }

  _getMultilineAppearance(
    defaultAppearance: string,
    lines: string[],
    font: Font,
    fontSize: number,
    width: number,
    height: number,
    alignment: number,
    hPadding: number,
    vPadding: number,
    descent: number,
    lineHeight: number,
    annotationStorage: Map<string, AnnotationEditorSerial> | null
  ) {
    const buf = [];
    const totalWidth = width - 2 * hPadding;
    const prevInfo = { shift: 0 };
    for (let i = 0, ii = lines.length; i < ii; i++) {
      const line = lines[i];
      const chunks = this._splitLine(line, font, fontSize, totalWidth);
      for (let j = 0, jj = chunks.length; j < jj; j++) {
        const chunk = chunks[j];
        const vShift =
          i === 0 && j === 0 ? -vPadding - (lineHeight - descent) : -lineHeight;
        buf.push(
          this._renderText(
            chunk,
            font,
            fontSize,
            width,
            alignment,
            prevInfo,
            hPadding,
            vShift
          )
        );
      }
    }

    // Empty or it has a trailing whitespace.
    const colors = this.getBorderAndBackgroundAppearances(annotationStorage);
    const renderedText = buf.join("\n");

    return (
      `/Tx BMC q ${colors}BT ` +
      defaultAppearance +
      ` 1 0 0 1 0 ${numberToString(height)} Tm ${renderedText}` +
      " ET Q EMC"
    );
  }

  _splitLine(
    line: string, font: Font, fontSize: number, width: number,
    cache: CacheLine = newCacheLine()
  ): string[] {
    line = cache.line || line;

    const glyphs = cache.glyphs || font.charsToGlyphs(line);

    if (glyphs.length <= 1) {
      // Nothing to split
      return [line];
    }

    const positions = cache.positions || font.getCharPositions(line);
    const scale = fontSize / 1000;
    const chunks = [];

    let lastSpacePosInStringStart = -1;
    let lastSpacePosInStringEnd = -1;
    let lastSpacePos = -1;
    let startChunk = 0;
    let currentWidth = 0;

    for (let i = 0, ii = glyphs.length; i < ii; i++) {
      const [start, end] = positions[i];
      const glyph = glyphs[i];
      const glyphWidth = glyph.width * scale;
      if (glyph.unicode === " ") {
        if (currentWidth + glyphWidth > width) {
          // We can break here
          chunks.push(line.substring(startChunk, start));
          startChunk = start;
          currentWidth = glyphWidth;
          lastSpacePosInStringStart = -1;
          lastSpacePos = -1;
        } else {
          currentWidth += glyphWidth;
          lastSpacePosInStringStart = start;
          lastSpacePosInStringEnd = end;
          lastSpacePos = i;
        }
      } else if (currentWidth + glyphWidth > width) {
        // We must break to the last white position (if available)
        if (lastSpacePosInStringStart !== -1) {
          chunks.push(line.substring(startChunk, lastSpacePosInStringEnd));
          startChunk = lastSpacePosInStringEnd;
          i = lastSpacePos + 1;
          lastSpacePosInStringStart = -1;
          currentWidth = 0;
        } else {
          // Just break in the middle of the word
          chunks.push(line.substring(startChunk, start));
          startChunk = start;
          currentWidth = glyphWidth;
        }
      } else {
        currentWidth += glyphWidth;
      }
    }

    if (startChunk < line.length) {
      chunks.push(line.substring(startChunk, line.length));
    }

    return chunks;
  }

  async extractTextContent(evaluator: PartialEvaluator, task: WorkerTask, viewBox: RectType) {
    await super.extractTextContent(evaluator, task, viewBox);
    const text = this.data.textContent;
    if (!text) {
      return;
    }

    // The text extractor doesn't handle empty lines correctly, so if the
    // content we get is more or less (modulo whitespaces) the same as the
    // field value we just ignore it.
    const allText = text.join("\n");
    if (allText === this.data.fieldValue) {
      return;
    }
    const regex = allText.replaceAll(/([.*+?^${}()|[\]\\])|(\s+)/g, (_m, p1) =>
      p1 ? `\\${p1}` : "\\s+"
    );
    if (new RegExp(`^\\s*${regex}\\s*$`).test(<string>this.data.fieldValue)) {
      this.data.textContent = (<string>this.data.fieldValue).split("\n");
    }
  }

  getFieldObject(): TextWidgetFieldObject | null {
    return {
      id: this.data.id,
      value: this.data.fieldValue,
      defaultValue: this.data.defaultFieldValue || "",
      multiline: this.data.multiLine,
      password: this.hasFieldFlag(AnnotationFieldFlag.PASSWORD),
      charLimit: this.data.maxLen,
      comb: this.data.comb,
      editable: !this.data.readOnly,
      hidden: this.data.hidden,
      name: this.data.fieldName ?? null,
      rect: this.data.rect,
      actions: this.data.actions ?? null,
      page: this.data.pageIndex ?? null,
      strokeColor: this.data.borderColor,
      fillColor: this.data.backgroundColor,
      rotation: this.rotation,
      type: "text",
    };
  }
}

export interface ButtonWidgetData extends WidgetData {
  multiSelect: boolean;
  buttonValue: string | null;
  exportValue: string | null;
  checkBox: boolean;
  radioButton: boolean;
  pushButton: boolean;
  isTooltipOnly: boolean;
  action: string;
  url: string;
  dest: string | DestinationType | null;
  annotationType: AnnotationType;
  setOCGState: {
    state: string[],
    preserveRB: boolean;
  };
  resetForm: {
    fields: string[];
    refs: string[];
    include: boolean;
  };
  actions: Map<string, string[]>;
  attachment: {
    content: Uint8Array<ArrayBuffer>;
    filename: string;
    description: string;
  };
  attachmentDest: string | null;
  newWindow: boolean;
}

export interface ButtonWidgetFieldObject extends GeneralFieldObject {
  id: string;
  value: string | string[];
  defaultValue: string | string[] | null;
  exportValues: string | null;
  editable: boolean;
  name: string | null;
  rect: RectType | null;
  hidden: boolean
  actions: Map<string, string[]>;
  page: number | null;
  strokeColor: Uint8ClampedArray<ArrayBuffer> | null;
  fillColor: Uint8ClampedArray<ArrayBuffer> | null;
  rotation: number;
  type: string;
}

class ButtonWidgetAnnotation extends WidgetAnnotation<ButtonWidgetData> {

  protected checkedAppearance: BaseStream | null;
  protected uncheckedAppearance: BaseStream | null;
  protected _fallbackFontDict: Dict | null = null;
  protected parent: Ref | Dict | unknown;
  constructor(params: AnnotationParameters) {
    super(params);

    this.checkedAppearance = null;
    this.uncheckedAppearance = null;

    this.data.checkBox = !this.hasFieldFlag(AnnotationFieldFlag.RADIO) &&
      !this.hasFieldFlag(AnnotationFieldFlag.PUSHBUTTON);
    this.data.radioButton = this.hasFieldFlag(AnnotationFieldFlag.RADIO) &&
      !this.hasFieldFlag(AnnotationFieldFlag.PUSHBUTTON);
    this.data.pushButton = this.hasFieldFlag(AnnotationFieldFlag.PUSHBUTTON);
    this.data.isTooltipOnly = false;

    if (this.data.checkBox) {
      this._processCheckBox(params);
    } else if (this.data.radioButton) {
      this._processRadioButton(params);
    } else if (this.data.pushButton) {
      this.data.hasOwnCanvas = true;
      this.data.noHTML = false;
      this._processPushButton(params);
    } else {
      warn("Invalid field flags for button widget annotation");
    }
  }

  async getOperatorList(
    evaluator: PartialEvaluator,
    task: WorkerTask,
    intent: number,
    annotationStorage: Map<string, AnnotationEditorSerial> | null
  ) {
    // 这显然是一段废弃的代码，明明函数只有四个参数，但是却有五个参数，
    // 而且是一个明显的错位
    if (this.data.pushButton) {
      return super.getOperatorList(
        evaluator,
        task,
        intent,
        // false, // we use normalAppearance to render the button 
        annotationStorage
      );
    }

    let value = null;
    let rotation = null;
    if (annotationStorage) {
      interface MaybeType {
        // 不知道什么类型，确实也可以是unknown
        value: unknown;
        rotation: number;
      }
      const storageEntry = <MaybeType | undefined>annotationStorage.get(this.data.id);
      value = storageEntry ? storageEntry.value : null;
      rotation = storageEntry ? storageEntry.rotation : null;
    }

    if (value === null && this.appearance) {
      // Nothing in the annotationStorage.
      // But we've a default appearance so use it.
      return super.getOperatorList(evaluator, task, intent, annotationStorage);
    }

    if (value === null || value === undefined) {
      // There is no default appearance so use the one derived
      // from the field value.
      value = this.data.checkBox ? this.data.fieldValue === this.data.exportValue
        : this.data.fieldValue === this.data.buttonValue;
    }

    const appearance = value ? this.checkedAppearance
      : this.uncheckedAppearance;
    if (appearance) {
      const savedAppearance = this.appearance;
      const savedMatrix = <TransformType>lookupMatrix(
        appearance.dict!.getArrayValue(DictKey.Matrix),
        IDENTITY_MATRIX
      );

      if (rotation) {
        appearance.dict!.set(
          DictKey.Matrix,
          this.getRotationMatrix(annotationStorage)
        );
      }

      this.appearance = appearance;
      const operatorList = super.getOperatorList(
        evaluator,
        task,
        intent,
        annotationStorage
      );
      this.appearance = savedAppearance;
      appearance.dict!.set(DictKey.Matrix, savedMatrix);
      return operatorList;
    }

    // No appearance
    return {
      opList: new OperatorList(),
      separateForm: false,
      separateCanvas: false,
    };
  }

  async save(
    evaluator: PartialEvaluator,
    task: WorkerTask,
    annotationStorage: Map<string, AnnotationEditorSerial> | null
  ): Promise<AnnotationSaveRef[] | null> {
    if (this.data.checkBox) {
      return this._saveCheckbox(evaluator, task, annotationStorage);
    }

    if (this.data.radioButton) {
      return this._saveRadioButton(evaluator, task, annotationStorage);
    }

    // Nothing to save
    return null;
  }

  async _saveCheckbox(evaluator: PartialEvaluator, _task: WorkerTask, annotationStorage: Map<string, AnnotationEditorSerial> | null) {
    if (!annotationStorage) {
      return null;
    }
    interface MaybeType {
      noView?: boolean,
      noPrint?: boolean,
      value?: boolean,
      rotation?: number
    }
    const storageEntry = <MaybeType>annotationStorage.get(this.data.id);
    const flags = this._buildFlags(storageEntry?.noView, storageEntry?.noPrint);
    let rotation = storageEntry?.rotation;
    let value = storageEntry?.value;

    if (rotation === undefined && flags === undefined) {
      if (value === undefined) {
        return null;
      }

      const defaultValue = this.data.fieldValue === this.data.exportValue;
      if (defaultValue === value) {
        return null;
      }
    }

    let dict = <Dict>evaluator.xref.fetchIfRef(this.ref!);
    if (!(dict instanceof DictImpl)) {
      return null;
    }
    dict = dict.clone();

    if (rotation === undefined) {
      rotation = this.rotation;
    }
    if (value === undefined) {
      value = this.data.fieldValue === this.data.exportValue;
    }

    const name = Name.get(value ? this.data.exportValue! : "Off")!;
    dict.set(DictKey.V, name);
    dict.set(DictKey.AS, name);
    dict.set(DictKey.M, `D:${getModificationDate()}`);
    if (flags !== undefined) {
      dict.set(DictKey.F, flags!);
    }

    const maybeMK = this._getMKDict(rotation);
    if (maybeMK) {
      dict.set(DictKey.MK, maybeMK);
    }

    const buffer = <string[]>[];
    await writeObject(this.ref!, dict, buffer, evaluator.xref.encrypt);

    return [{ ref: this.ref, data: buffer.join("") }];
  }

  async _saveRadioButton(evaluator: PartialEvaluator, _task: WorkerTask, annotationStorage: Map<string, Record<string, any>> | null) {
    if (!annotationStorage) {
      return null;
    }
    const storageEntry = annotationStorage.get(this.data.id);
    const flags = this._buildFlags(storageEntry?.noView, storageEntry?.noPrint);
    let rotation = storageEntry?.rotation,
      value = storageEntry?.value;

    if (rotation === undefined && flags === undefined) {
      if (value === undefined) {
        return null;
      }

      const defaultValue = this.data.fieldValue === this.data.buttonValue;
      if (defaultValue === value) {
        return null;
      }
    }

    let dict = <Dict>evaluator.xref.fetchIfRef(this.ref!);
    if (!(dict instanceof DictImpl)) {
      return null;
    }
    dict = dict.clone();

    if (value === undefined) {
      value = this.data.fieldValue === this.data.buttonValue;
    }

    if (rotation === undefined) {
      rotation = this.rotation;
    }

    const name = Name.get(value ? <string>this.data.buttonValue : "Off");
    const buffer = <string[]>[];
    let parentData = null;

    if (value) {
      if (this.parent instanceof Ref) {
        const parent = <Dict>evaluator.xref.fetch(this.parent);
        parent.set(DictKey.V, name);
        await writeObject(this.parent, parent, buffer, evaluator.xref.encrypt);
        parentData = buffer.join("");
        buffer.length = 0;
      } else if (this.parent instanceof DictImpl) {
        this.parent.set(DictKey.V, name!);
      }
    }

    if (!this.parent) {
      // If there is no parent then we must set the value in the field.
      dict.set(DictKey.V, name!);
    }

    dict.set(DictKey.AS, name!);
    dict.set(DictKey.M, `D:${getModificationDate()}`);
    if (flags !== undefined) {
      dict.set(DictKey.F, flags!);
    }

    const maybeMK = this._getMKDict(rotation);
    if (maybeMK) {
      dict.set(DictKey.MK, maybeMK);
    }

    await writeObject(this.ref!, dict, buffer, evaluator.xref.encrypt);
    const newRefs = [{ ref: this.ref, data: buffer.join("") }];
    if (parentData) {
      newRefs.push({ ref: <Ref>this.parent, data: parentData });
    }

    return newRefs;
  }

  _getDefaultCheckedAppearance(params: AnnotationParameters, type: string) {
    const width = this.data.rect![2] - this.data.rect![0];
    const height = this.data.rect![3] - this.data.rect![1];
    const bbox: RectType = [0, 0, width, height];

    // Ratio used to have a mark slightly smaller than the bbox.
    const FONT_RATIO = 0.8;
    const fontSize = Math.min(width, height) * FONT_RATIO;

    // Char Metrics
    // Widths came from widths for ZapfDingbats.
    // Heights are guessed with Fontforge and FoxitDingbats.pfb.
    let metrics, char;
    if (type === "check") {
      // Char 33 (2713 in unicode)
      metrics = {
        width: 0.755 * fontSize,
        height: 0.705 * fontSize,
      };
      char = "\x33";
    } else if (type === "disc") {
      // Char 6C (25CF in unicode)
      metrics = {
        width: 0.791 * fontSize,
        height: 0.705 * fontSize,
      };
      char = "\x6C";
    } else {
      unreachable(`_getDefaultCheckedAppearance - unsupported type: ${type}`);
    }

    // Values to center the glyph in the bbox.
    const xShift = numberToString((width - metrics.width) / 2);
    const yShift = numberToString((height - metrics.height) / 2);

    const appearance = `q BT /PdfJsZaDb ${fontSize} Tf 0 g ${xShift} ${yShift} Td (${char}) Tj ET Q`;

    const appearanceStreamDict = new DictImpl(params.xref);
    appearanceStreamDict.set(DictKey.FormType, 1);
    appearanceStreamDict.set(DictKey.Subtype, Name.get("Form"));
    appearanceStreamDict.set(DictKey.Type, Name.get("XObject"));
    appearanceStreamDict.set(DictKey.BBox, bbox);
    appearanceStreamDict.set(DictKey.Matrix, [1, 0, 0, 1, 0, 0]);
    appearanceStreamDict.set(DictKey.Length, appearance.length);

    const resources = new DictImpl(params.xref);
    const font = new DictImpl(params.xref);
    font.set(DictKey.PdfJsZaDb, this.fallbackFontDict);
    resources.set(DictKey.Font, font);

    appearanceStreamDict.set(DictKey.Resources, resources);

    this.checkedAppearance = new StringStream(appearance);
    this.checkedAppearance.dict = appearanceStreamDict;

    this._streams.push(this.checkedAppearance);
  }

  _processCheckBox(params: AnnotationParameters) {
    const customAppearance = params.dict.getValue(DictKey.AP);
    if (!(customAppearance instanceof DictImpl)) {
      return;
    }

    const normalAppearance = customAppearance.getValue(DictKey.N);
    if (!(normalAppearance instanceof DictImpl)) {
      return;
    }

    // See https://bugzilla.mozilla.org/show_bug.cgi?id=1722036.
    // If we've an AS and a V then take AS.
    const asValue = this._decodeFormValue(params.dict.getValue(DictKey.AS));
    if (typeof asValue === "string") {
      this.data.fieldValue = asValue;
    }

    const yes =
      this.data.fieldValue !== null && this.data.fieldValue !== "Off"
        ? <string>this.data.fieldValue
        : "Yes";

    const exportValues = <(string | undefined)[]>normalAppearance.getKeys();
    if (exportValues.length === 0) {
      exportValues.push("Off", yes);
    } else if (exportValues.length === 1) {
      if (exportValues[0] === "Off") {
        exportValues.push(yes);
      } else {
        exportValues.unshift("Off");
      }
    } else if (exportValues.includes(yes)) {
      exportValues.length = 0;
      exportValues.push("Off", yes);
    } else {
      const otherYes = exportValues.find(v => v !== "Off");
      exportValues.length = 0;
      exportValues.push("Off", otherYes);
    }

    // Don't use a "V" entry pointing to a non-existent appearance state,
    // see e.g. bug1720411.pdf where it's an *empty* Name-instance.
    if (!exportValues.includes(<string>this.data.fieldValue)) {
      this.data.fieldValue = "Off";
    }

    this.data.exportValue = <string>exportValues[1];

    const checkedAppearance = normalAppearance.getValue(<DictKey>this.data.exportValue!);
    this.checkedAppearance =
      checkedAppearance instanceof BaseStream ? checkedAppearance : null;
    const uncheckedAppearance = normalAppearance.getValue(DictKey.Off);
    this.uncheckedAppearance =
      uncheckedAppearance instanceof BaseStream ? uncheckedAppearance : null;

    if (this.checkedAppearance) {
      this._streams.push(this.checkedAppearance);
    } else {
      this._getDefaultCheckedAppearance(params, "check");
    }
    if (this.uncheckedAppearance) {
      this._streams.push(this.uncheckedAppearance);
    }
    this._fallbackFontDict = this.fallbackFontDict;
    if (this.data.defaultFieldValue === null) {
      this.data.defaultFieldValue = "Off";
    }
  }

  _processRadioButton(params: AnnotationParameters) {
    this.data.buttonValue = null;

    // The parent field's `V` entry holds a `Name` object with the appearance
    // state of whichever child field is currently in the "on" state.
    const fieldParent = params.dict.getValue(DictKey.Parent);
    if (fieldParent instanceof DictImpl) {
      this.parent = params.dict.getRaw(DictKey.Parent);
      const fieldParentValue = fieldParent.getValue(DictKey.V);
      if (fieldParentValue instanceof Name) {
        this.data.fieldValue = this._decodeFormValue(fieldParentValue);
      }
    }

    // The button's value corresponds to its appearance state.
    const appearanceStates = params.dict.getValue(DictKey.AP);
    if (!(appearanceStates instanceof DictImpl)) {
      return;
    }
    const normalAppearance = appearanceStates.getValue(DictKey.N);
    if (!(normalAppearance instanceof DictImpl)) {
      return;
    }
    for (const key of normalAppearance.getKeys()) {
      if (key !== "Off") {
        this.data.buttonValue = <string>this._decodeFormValue(key);
        break;
      }
    }

    const checkedAppearance = normalAppearance.getValue(<DictKey>this.data.buttonValue!);
    this.checkedAppearance =
      checkedAppearance instanceof BaseStream ? checkedAppearance : null;
    const uncheckedAppearance = normalAppearance.getValue(DictKey.Off);
    this.uncheckedAppearance =
      uncheckedAppearance instanceof BaseStream ? uncheckedAppearance : null;

    if (this.checkedAppearance) {
      this._streams.push(this.checkedAppearance);
    } else {
      this._getDefaultCheckedAppearance(params, "disc");
    }
    if (this.uncheckedAppearance) {
      this._streams.push(this.uncheckedAppearance);
    }
    this._fallbackFontDict = this.fallbackFontDict;
    if (this.data.defaultFieldValue === null) {
      this.data.defaultFieldValue = "Off";
    }
  }

  _processPushButton(params: AnnotationParameters) {
    const { dict, annotationGlobals } = params;

    if (!dict.has(DictKey.A) && !dict.has(DictKey.AA) && !this.data.alternativeText) {
      warn("Push buttons without action dictionaries are not supported");
      return;
    }

    this.data.isTooltipOnly = !dict.has(DictKey.A) && !dict.has(DictKey.AA);

    Catalog.parseDestDictionary(
      dict,
      this.data,
      annotationGlobals.baseUrl,
      annotationGlobals.attachments,
    );
  }

  getFieldObject(): ButtonWidgetFieldObject {
    let type = "button";
    let exportValues;
    if (this.data.checkBox) {
      type = "checkbox";
      exportValues = this.data.exportValue;
    } else if (this.data.radioButton) {
      type = "radiobutton";
      exportValues = this.data.buttonValue;
    }
    return {
      id: this.data.id,
      value: this.data.fieldValue || "Off",
      defaultValue: this.data.defaultFieldValue,
      exportValues: exportValues ?? null,
      editable: !this.data.readOnly,
      name: this.data.fieldName ?? null,
      rect: this.data.rect,
      hidden: this.data.hidden,
      actions: this.data.actions,
      page: this.data.pageIndex ?? null,
      strokeColor: this.data.borderColor,
      fillColor: this.data.backgroundColor,
      rotation: this.rotation,
      type,
    };
  }

  get fallbackFontDict() {
    const dict = new DictImpl();
    dict.set(DictKey.BaseFont, Name.get("ZapfDingbats"));
    dict.set(DictKey.Type, Name.get("FallbackType"));
    dict.set(DictKey.Subtype, Name.get("FallbackType"));
    dict.set(DictKey.Encoding, Name.get("ZapfDingbatsEncoding"));

    return shadow(this, "fallbackFontDict", dict);
  }
}

export interface ChoiceWidgetData extends WidgetData {
  multiSelect: boolean;
}

export interface ChoiceWidgetFieldObject extends GeneralFieldObject {
  id: string;
  value: string | null;
  defaultValue: string | string[] | null;
  editable: boolean;
  name: string | null;
  rect: RectType | null;
  numItems: number;
  multipleSelection: boolean;
  hidden: boolean;
  actions: Map<string, string[]> | null;
  items: {
    exportValue: string | null;
    displayValue: string | null;
  }[] | null
  page: number | null;
  strokeColor: Uint8ClampedArray<ArrayBuffer> | null;
  fillColor: Uint8ClampedArray<ArrayBuffer> | null;
  rotation: number;
  type: string;
}

class ChoiceWidgetAnnotation extends WidgetAnnotation<ChoiceWidgetData> {

  hasIndices: boolean;
  // TODO 要再推断推断
  indices: number[];

  constructor(params: AnnotationParameters) {
    super(params);

    const { dict, xref } = params;

    this.indices = dict.getArrayValue(DictKey.I);
    this.hasIndices = Array.isArray(this.indices) && this.indices.length > 0;

    // Determine the options. The options array may consist of strings or
    // arrays. If the array consists of arrays, then the first element of
    // each array is the export value and the second element of each array is
    // the display value. If the array consists of strings, then these
    // represent both the export and display value. In this case, we convert
    // it to an array of arrays as well for convenience in the display layer.
    // Note that the specification does not state that the `Opt` field is
    // inheritable, but in practice PDF generators do make annotations
    // inherit the options from a parent annotation (issue 8094).
    this.data.options = [];

    const options = getSingleInheritableProperty(dict, DictKey.Opt);
    if (Array.isArray(options)) {
      for (let i = 0, ii = options.length; i < ii; i++) {
        const option = xref.fetchIfRef(<object>options[i]);
        const isOptionArray = Array.isArray(option);

        this.data.options[i] = {
          exportValue: <string>this._decodeFormValue(
            isOptionArray ? xref.fetchIfRef(option[0]) : option
          ),
          displayValue: <string>this._decodeFormValue(
            isOptionArray ? xref.fetchIfRef(option[1]) : option
          ),
        };
      }
    }

    if (!this.hasIndices) {
      // The field value can be `null` if no item is selected, a string if one
      // item is selected or an array of strings if multiple items are selected.
      // For consistency in the API and convenience in the display layer, we
      // always make the field value an array with zero, one or multiple items.
      if (typeof this.data.fieldValue === "string") {
        this.data.fieldValue = [this.data.fieldValue];
      } else if (!this.data.fieldValue) {
        this.data.fieldValue = [];
      }
    } else {
      // The specs say that we should have an indices array only with
      // multiselectable Choice and the "V" entry should have the
      // precedence, but Acrobat itself is using it whatever the
      // the "V" entry is (see bug 1770750).
      this.data.fieldValue = [];
      const ii = this.data.options.length;
      for (const i of this.indices) {
        if (Number.isInteger(i) && i >= 0 && i < ii) {
          this.data.fieldValue.push(<string>this.data.options[i].exportValue);
        }
      }
    }

    // Process field flags for the display layer.
    this.data.combo = this.hasFieldFlag(AnnotationFieldFlag.COMBO);
    this.data.multiSelect = this.hasFieldFlag(AnnotationFieldFlag.MULTISELECT);
    this._hasText = true;
  }

  getFieldObject(): ChoiceWidgetFieldObject {
    const type = this.data.combo ? "combobox" : "listbox";
    const value = this.data.fieldValue!.length > 0 ? this.data.fieldValue![0] : null;
    return {
      id: this.data.id,
      value,
      defaultValue: this.data.defaultFieldValue,
      editable: !this.data.readOnly,
      name: this.data.fieldName ?? null,
      rect: this.data.rect,
      numItems: this.data.fieldValue!.length,
      multipleSelection: this.data.multiSelect,
      hidden: this.data.hidden,
      actions: this.data.actions ?? null,
      items: this.data.options,
      page: this.data.pageIndex ?? null,
      strokeColor: this.data.borderColor,
      fillColor: this.data.backgroundColor,
      rotation: this.rotation,
      type,
    };
  }

  amendSavedDict(annotationStorage: Map<string, Record<string, any>> | null, dict: Dict) {
    if (!this.hasIndices) {
      return;
    }
    let values = annotationStorage?.get(this.data.id)?.value;
    if (!Array.isArray(values)) {
      values = [values];
    }
    const indices = [];
    const options = this.data.options!;
    for (let i = 0, j = 0, ii = options.length; i < ii; i++) {
      if (options[i].exportValue === values[j]) {
        indices.push(i);
        j += 1;
      }
    }
    dict.set(DictKey.I, indices);
  }

  async _getAppearance(evaluator: PartialEvaluator, task: WorkerTask, intent: number
    , annotationStorage: Map<string, AnnotationEditorSerial> | null) {
    if (this.data.combo) {
      return super._getAppearance(evaluator, task, intent, annotationStorage);
    }

    let exportedValue: string | string[] | null = null;
    let rotation: number | null = null;
    interface StorageEntry {
      rotation: number;
      value: string;
    }
    const storageEntry = <StorageEntry | undefined>annotationStorage?.get(this.data.id);
    if (storageEntry) {
      rotation = storageEntry.rotation;
      exportedValue = storageEntry.value;
    }

    if (rotation === null && exportedValue === null && !this._needAppearances) {
      // The annotation hasn't been rendered so use the appearance
      return null;
    }

    if (exportedValue === undefined) {
      exportedValue = this.data.fieldValue;
    } else if (!Array.isArray(exportedValue)) {
      exportedValue = [<string>exportedValue];
    }

    const defaultPadding = 1;
    const defaultHPadding = 2;
    let totalHeight = this.data.rect![3] - this.data.rect![1];
    let totalWidth = this.data.rect![2] - this.data.rect![0];

    if (rotation === 90 || rotation === 270) {
      [totalWidth, totalHeight] = [totalHeight, totalWidth];
    }

    const lineCount = this.data.options!.length;
    const valueIndices = [];
    for (let i = 0; i < lineCount; i++) {
      const exportValue = <string>this.data.options![i].exportValue;
      if (exportedValue!.includes(exportValue)) {
        valueIndices.push(i);
      }
    }

    if (!this._defaultAppearance) {
      // The DA is required and must be a string.
      // If there is no font named Helvetica in the resource dictionary,
      // the evaluator will fall back to a default font.
      // Doing so prevents exceptions and allows saving/printing
      // the file as expected.
      this.data.defaultAppearanceData = parseDefaultAppearance(
        (this._defaultAppearance = "/Helvetica 0 Tf 0 g")
      );
    }

    const font = await WidgetAnnotation._getFontData(
      evaluator,
      task,
      this.data.defaultAppearanceData!,
      this._fieldResources.mergedResources
    );

    let defaultAppearance;
    let { fontSize } = this.data.defaultAppearanceData!;
    if (!fontSize) {
      const lineHeight = (totalHeight - defaultPadding) / lineCount;
      let lineWidth = -1;
      let value;
      for (const { displayValue } of this.data.options!) {
        const width = this._getTextWidth(<string>displayValue, font!);
        if (width > lineWidth) {
          lineWidth = width;
          value = displayValue;
        }
      }

      [defaultAppearance, fontSize] = this._computeFontSize(
        lineHeight,
        totalWidth - 2 * defaultHPadding,
        <string>value,
        font!,
        -1
      );
    } else {
      defaultAppearance = this._defaultAppearance;
    }

    const lineHeight = fontSize * LINE_FACTOR;
    const vPadding = (lineHeight - fontSize) / 2;
    const numberOfVisibleLines = Math.floor(totalHeight / lineHeight);

    let firstIndex = 0;
    if (valueIndices.length > 0) {
      const minIndex = Math.min(...valueIndices);
      const maxIndex = Math.max(...valueIndices);

      firstIndex = Math.max(0, maxIndex - numberOfVisibleLines + 1);
      if (firstIndex > minIndex) {
        firstIndex = minIndex;
      }
    }
    const end = Math.min(firstIndex + numberOfVisibleLines + 1, lineCount);

    const buf = ["/Tx BMC q", `1 1 ${totalWidth} ${totalHeight} re W n`];

    if (valueIndices.length) {
      // This value has been copied/pasted from annotation-choice-widget.pdf.
      // It corresponds to rgb(153, 193, 218).
      buf.push("0.600006 0.756866 0.854904 rg");

      // Highlight the lines in filling a blue rectangle at the selected
      // positions.
      for (const index of valueIndices) {
        if (firstIndex <= index && index < end) {
          buf.push(
            `1 ${totalHeight - (index - firstIndex + 1) * lineHeight
            } ${totalWidth} ${lineHeight} re f`
          );
        }
      }
    }
    buf.push("BT", defaultAppearance, `1 0 0 1 0 ${totalHeight} Tm`);

    const prevInfo = { shift: 0 };
    for (let i = firstIndex; i < end; i++) {
      const { displayValue } = this.data.options![i];
      const vpadding = i === firstIndex ? vPadding : 0;
      buf.push(
        this._renderText(
          <string>displayValue,
          <Font>font!,
          fontSize,
          totalWidth,
          0,
          prevInfo,
          defaultHPadding,
          -lineHeight + vpadding
        )
      );
    }

    buf.push("ET Q EMC");

    return buf.join("\n");
  }
}

export interface SignatureFieldObject extends FieldObject {
  id: string;
  value: null;
  page: number | null;
  type: string;
}

class SignatureWidgetAnnotation extends WidgetAnnotation<WidgetData> {
  constructor(params: AnnotationParameters) {
    super(params);

    // Unset the fieldValue since it's (most likely) a `Dict` which is
    // non-serializable and will thus cause errors when sending annotations
    // to the main-thread (issue 10347).
    this.data.fieldValue = null;
    this.data.hasOwnCanvas = this.data.noRotate;
    this.data.noHTML = !this.data.hasOwnCanvas;
  }

  getFieldObject(): SignatureFieldObject {
    return {
      id: this.data.id,
      value: null,
      page: this.data.pageIndex ?? null,
      type: "signature",
    };
  }
}

export interface TextData extends MarkupData, WidgetData {
  stateModel: string | null;
  state: Name[] | null;
  annotationType: AnnotationType;
  name: string;
  hidden: boolean;
  titleObj: StringObj;
}

class TextAnnotation extends MarkupAnnotation<TextData> {
  constructor(params: AnnotationParameters) {
    const DEFAULT_ICON_SIZE = 22; // px

    super(params);

    // No rotation for Text (see 12.5.6.4).
    this.data.noRotate = true;
    this.data.hasOwnCanvas = this.data.noRotate;
    this.data.noHTML = false;

    const { dict } = params;
    this.data.annotationType = AnnotationType.TEXT;

    if (this.data.hasAppearance) {
      this.data.name = "NoIcon";
    } else {
      this.data.rect![1] = this.data.rect![3] - DEFAULT_ICON_SIZE;
      this.data.rect![2] = this.data.rect![0] + DEFAULT_ICON_SIZE;
      this.data.name = dict.has(DictKey.Name) ? (<Name>dict.getValue(DictKey.Name)).name : "Note";
    }

    if (dict.has(DictKey.State)) {
      this.data.state = <Name[]>dict.getValue(DictKey.State) || null;
      this.data.stateModel = dict.getValue(DictKey.StateModel) || null;
    } else {
      this.data.state = null;
      this.data.stateModel = null;
    }
  }
}

export interface LinkData extends AnnotationData {
  annotationType: AnnotationType;
  setOCGState: {
    state: string[],
    preserveRB: boolean;
  };
  resetForm: {
    fields: string[];
    refs: string[];
    include: boolean;
  };
  actions: Map<string, string[]>;
  dest: string | DestinationType | null;
  attachment: {
    content: Uint8Array<ArrayBuffer>;
    filename: string;
    description: string;
  };
  attachmentDest: string | null;
  action: string;
  isTooltipOnly: boolean;
  url: string;
  newWindow: boolean;
}

class LinkAnnotation extends Annotation<LinkData> {
  constructor(params: AnnotationParameters) {
    super(params);

    const { dict, annotationGlobals } = params;
    this.data.annotationType = AnnotationType.LINK;

    // A link is never rendered on the main canvas so we must render its HTML
    // version.
    this.data.noHTML = false;

    const quadPoints = getQuadPoints(dict, this.rectangle);
    if (quadPoints) {
      this.data.quadPoints = quadPoints;
    }

    // The color entry for a link annotation is the color of the border.
    this.data.borderColor ||= this.data.color;

    Catalog.parseDestDictionary(
      dict,
      this.data,
      annotationGlobals.baseUrl,
      annotationGlobals.attachments,
    );
  }
}

export interface PopupData extends AnnotationData {
  open: boolean;
  annotationType: AnnotationType;
  parentRect: RectType;
}

export class PopupAnnotation extends Annotation<PopupData> {
  constructor(params: AnnotationParameters) {
    super(params);

    const { dict } = params;
    this.data.annotationType = AnnotationType.POPUP;

    // A pop-up is never rendered on the main canvas so we must render its HTML
    // version.
    this.data.noHTML = false;

    if (
      this.data.rect![0] === this.data.rect![2] ||
      this.data.rect![1] === this.data.rect![3]
    ) {
      this.data.rect = null;
    }

    let parentItem = <Dict>dict.getValue(DictKey.Parent);
    if (!parentItem) {
      warn("Popup annotation has a missing or invalid parent annotation.");
      return;
    }
    this.data.parentRect = lookupNormalRect(parentItem.getArrayValue(DictKey.Rect), null)!;

    const rt = parentItem.getValue(DictKey.RT);
    if (isName(rt, AnnotationReplyType.GROUP)) {
      // Subordinate annotations in a group should inherit
      // the group attributes from the primary annotation.
      parentItem = <Dict>parentItem.getValue(DictKey.IRT);
    }

    if (!parentItem.has(DictKey.M)) {
      this.data.modificationDate = null;
    } else {
      this.setModificationDate(parentItem.getValue(DictKey.M));
      this.data.modificationDate = this.modificationDate;
    }

    if (!parentItem.has(DictKey.C)) {
      // Fall back to the default background color.
      this.data.color = null;
    } else {
      this.setColor(parentItem.getArrayValue(DictKey.C));
      this.data.color = this.color;
    }

    // If the Popup annotation is not viewable, but the parent annotation is,
    // that is most likely a bug. Fallback to inherit the flags from the parent
    // annotation (this is consistent with the behaviour in Adobe Reader).
    if (!this.viewable) {
      const parentFlags = <number>parentItem.getValue(DictKey.F);
      if (this._isViewable(parentFlags)) {
        this.setFlags(parentFlags);
      }
    }

    this.setTitle(<string>parentItem.getValue(DictKey.T));
    this.data.titleObj = this._title;

    this.setContents(<string>parentItem.getValue(DictKey.Contents));
    this.data.contentsObj = this._contents;

    this.data.open = !!dict.getValue(DictKey.Open);
  }
}

export interface FreeTextData extends MarkupData {
  annotationType: AnnotationType;

}

class FreeTextAnnotation extends MarkupAnnotation<FreeTextData> {

  public ref: Ref | null = null;

  public refToReplace: Ref | null = null;

  protected _hasAppearance: boolean;

  constructor(params: Partial<AnnotationParameters>) {
    super(<AnnotationParameters>params);

    // It uses its own canvas in order to be hidden if edited.
    // But if it has the noHTML flag, it means that we don't want to be able
    // to modify it so we can just draw it on the main canvas.
    this.data.hasOwnCanvas = this.data.noRotate;
    this.data.isEditable = !this.data.noHTML;
    // We want to be able to add mouse listeners to the annotation.
    this.data.noHTML = false;

    const evaluatorOptions = params.evaluatorOptions!;
    const xref = params.xref!;
    const dict = params.dict!;
    this.data.annotationType = AnnotationType.FREETEXT;
    this.setDefaultAppearance(<AnnotationParameters>params);
    this._hasAppearance = !!this.appearance;

    if (this._hasAppearance) {
      const { fontColor, fontSize } = parseAppearanceStream(
        <Stream>this.appearance!,
        evaluatorOptions,
        xref
      );
      this.data.defaultAppearanceData!.fontColor = fontColor;
      this.data.defaultAppearanceData!.fontSize = fontSize || 10;
    } else {
      this.data.defaultAppearanceData!.fontSize ||= 10;
      const { fontColor, fontSize } = this.data.defaultAppearanceData!;
      if (this._contents.str) {
        this.data.textContent = this._contents.str.split(/\r\n?|\n/).map(line => line.trimEnd());
        const { coords, bbox, matrix } = FakeUnicodeFont.getFirstPositionInfo(
          this.rectangle, this.rotation, fontSize
        );
        this.data.textPosition = this._transformPoint(coords, bbox, matrix!);
      }
      if (this._isOffscreenCanvasSupported) {
        const strokeAlpha = dict.getValue(DictKey.CA);
        const fakeUnicodeFont = new FakeUnicodeFont(xref, "sans-serif");
        this.appearance = fakeUnicodeFont.createAppearance(
          this._contents.str,
          this.rectangle,
          this.rotation,
          fontSize,
          fontColor,
          strokeAlpha
        );
        this._streams.push(this.appearance);
      } else {
        warn(
          "FreeTextAnnotation: OffscreenCanvas is not supported, annotation may not render correctly."
        );
      }
    }
  }

  get hasTextContent() {
    return this._hasAppearance;
  }

  static createNewDict(annotation: FreeTextEditorSerial, xref: XRefImpl, apRef: Ref | null, ap: StringStream | null) {
    const { color, fontSize, oldAnnotation, rect, rotation, user, value } = annotation;
    const freetext = oldAnnotation || new DictImpl(xref);
    freetext.set(DictKey.Type, Name.get("Annot"));
    freetext.set(DictKey.Subtype, Name.get("FreeText"));
    if (oldAnnotation) {
      freetext.set(DictKey.M, `D:${getModificationDate()}`);
      // TODO: We should try to generate a new RC from the content we've.
      // For now we can just remove it to avoid any issues.
      freetext.delete(DictKey.RC);
    } else {
      freetext.set(DictKey.CreationDate, `D:${getModificationDate()}`);
    }
    freetext.set(DictKey.Rect, rect);
    const da = `/Helv ${fontSize} Tf ${getPdfColor(color, /* isFill */ true)}`;
    freetext.set(DictKey.DA, da);
    freetext.set(DictKey.Contents, stringToAsciiOrUTF16BE(value));
    freetext.set(DictKey.F, 4);
    freetext.set(DictKey.Border, [0, 0, 0]);
    freetext.set(DictKey.Rotate, rotation);

    if (user) {
      freetext.set(DictKey.T, stringToAsciiOrUTF16BE(user));
    }

    if (apRef || ap) {
      const n = new DictImpl(xref);
      freetext.set(DictKey.AP, n);

      if (apRef) {
        n.set(DictKey.N, apRef);
      } else {
        n.set(DictKey.N, ap!);
      }
    }

    return freetext;
  }

  static async createNewAppearanceStream(
    annotation: FreeTextEditorSerial,
    xref: XRefImpl,
    evaluator: PartialEvaluator,
    task: WorkerTask,
    baseFontRef: Ref | null,
  ) {

    const { color, fontSize, rect, rotation, value } = annotation;

    const resources = new DictImpl(xref);
    const font = new DictImpl(xref);
    if (baseFontRef) {
      font.set(DictKey.Helv, baseFontRef);
    } else {
      const baseFont = new DictImpl(xref);
      baseFont.set(DictKey.BaseFont, Name.get("Helvetica"));
      baseFont.set(DictKey.Type, Name.get("Font"));
      baseFont.set(DictKey.Subtype, Name.get("Type1"));
      baseFont.set(DictKey.Encoding, Name.get("WinAnsiEncoding"));
      font.set(DictKey.Helv, baseFont);
    }
    resources.set(DictKey.Font, font);

    const helv = await WidgetAnnotation._getFontData(
      evaluator, task, { fontName: "Helv", fontSize }, resources
    );

    const [x1, y1, x2, y2] = rect;
    let w = x2 - x1;
    let h = y2 - y1;

    if (rotation % 180 !== 0) {
      [w, h] = [h, w];
    }

    const lines = value.split("\n");
    const scale = fontSize / 1000;
    let totalWidth = -Infinity;
    const encodedLines = [];
    for (let line of lines) {
      const encoded = helv!.encodeString(line);
      if (encoded.length > 1) {
        // The font doesn't contain all the chars.
        return null;
      }
      line = encoded.join("");
      encodedLines.push(line);
      let lineWidth = 0;
      const glyphs = helv!.charsToGlyphs(line);
      for (const glyph of glyphs) {
        lineWidth += glyph.width * scale;
      }
      totalWidth = Math.max(totalWidth, lineWidth);
    }

    let hscale = 1;
    if (totalWidth > w) {
      hscale = w / totalWidth;
    }
    let vscale = 1;
    const lineHeight = LINE_FACTOR * fontSize;
    const lineAscent = (LINE_FACTOR - LINE_DESCENT_FACTOR) * fontSize;
    const totalHeight = lineHeight * lines.length;
    if (totalHeight > h) {
      vscale = h / totalHeight;
    }
    const fscale = Math.min(hscale, vscale);
    const newFontSize = fontSize * fscale;
    let firstPoint, clipBox, matrix;
    switch (rotation) {
      case 0:
        matrix = [1, 0, 0, 1];
        clipBox = [rect[0], rect[1], w, h];
        firstPoint = [rect[0], rect[3] - lineAscent];
        break;
      case 90:
        matrix = [0, 1, -1, 0];
        clipBox = [rect[1], -rect[2], w, h];
        firstPoint = [rect[1], -rect[0] - lineAscent];
        break;
      case 180:
        matrix = [-1, 0, 0, -1];
        clipBox = [-rect[2], -rect[3], w, h];
        firstPoint = [-rect[2], -rect[1] - lineAscent];
        break;
      case 270:
        matrix = [0, -1, 1, 0];
        clipBox = [-rect[3], rect[0], w, h];
        firstPoint = [-rect[3], rect[2] - lineAscent];
        break;
    }

    const buffer = [
      "q",
      `${matrix!.join(" ")} 0 0 cm`,
      `${clipBox!.join(" ")} re W n`,
      `BT`,
      `${getPdfColor(color, /* isFill */ true)}`,
      `0 Tc /Helv ${numberToString(newFontSize)} Tf`,
    ];

    buffer.push(
      `${firstPoint!.join(" ")} Td (${escapeString(encodedLines[0])}) Tj`
    );
    const vShift = numberToString(lineHeight);
    for (let i = 1, ii = encodedLines.length; i < ii; i++) {
      const line = encodedLines[i];
      buffer.push(`0 -${vShift} Td (${escapeString(line)}) Tj`);
    }
    buffer.push("ET", "Q");
    const appearance = buffer.join("\n");

    const appearanceStreamDict = new DictImpl(xref);
    appearanceStreamDict.set(DictKey.FormType, 1);
    appearanceStreamDict.set(DictKey.Subtype, Name.get("Form"));
    appearanceStreamDict.set(DictKey.Type, Name.get("XObject"));
    appearanceStreamDict.set(DictKey.BBox, rect);
    appearanceStreamDict.set(DictKey.Resources, resources);
    appearanceStreamDict.set(DictKey.Matrix, [1, 0, 0, 1, -rect[0], -rect[1]]);

    const ap = new StringStream(appearance);
    ap.dict = appearanceStreamDict;

    return ap;
  }
}

export interface LineData extends MarkupData {
  lineEndings: string[];
  lineCoordinates: RectType;
  annotationType: AnnotationType;
}

class LineAnnotation extends MarkupAnnotation<LineData> {
  constructor(params: AnnotationParameters) {
    super(params);

    const { dict, xref } = params;
    this.data.annotationType = AnnotationType.LINE;
    this.data.hasOwnCanvas = this.data.noRotate;
    this.data.noHTML = false;

    const lineCoordinates = <RectType>lookupRect(dict.getArrayValue(DictKey.L), [0, 0, 0, 0]);
    this.data.lineCoordinates = Util.normalizeRect(lineCoordinates);

    if (PlatformHelper.isMozCental()) {
      this.setLineEndings(dict.getArrayValue(DictKey.LE));
      this.data.lineEndings = this.lineEndings;
    }

    if (!this.appearance) {
      // The default stroke color is black.
      const strokeColor = this.color ? getPdfColorArray(this.color) : [0, 0, 0];
      const strokeAlpha = dict.getValue(DictKey.CA);

      const interiorColor = getRgbColor(dict.getArrayValue(DictKey.IC), null);
      // The default fill color is transparent. Setting the fill colour is
      // necessary if/when we want to add support for non-default line endings.
      const fillColor = interiorColor ? getPdfColorArray(interiorColor) : null;
      const fillAlpha = fillColor ? strokeAlpha : null;

      const borderWidth = this.borderStyle.width || 1,
        borderAdjust = 2 * borderWidth;

      // If the /Rect-entry is empty/wrong, create a fallback rectangle so that
      // we get similar rendering/highlighting behaviour as in Adobe Reader.
      const bbox = <RectType>[
        this.data.lineCoordinates![0] - borderAdjust,
        this.data.lineCoordinates![1] - borderAdjust,
        this.data.lineCoordinates![2] + borderAdjust,
        this.data.lineCoordinates![3] + borderAdjust,
      ];
      if (!Util.intersect(this.rectangle, bbox)) {
        this.rectangle = bbox;
      }

      this._setDefaultAppearance(
        xref,
        `${borderWidth} w`,
        strokeColor,
        fillColor,
        null,
        strokeAlpha,
        fillAlpha,
        (buffer, points) => {
          buffer.push(
            `${lineCoordinates[0]} ${lineCoordinates[1]} m`,
            `${lineCoordinates[2]} ${lineCoordinates[3]} l`,
            "S"
          );
          return [
            points[0] - borderWidth,
            points[2] + borderWidth,
            points[7] - borderWidth,
            points[3] + borderWidth,
          ];
        },
      );
    }
  }
}

export interface SquareData extends MarkupData {
  annotationType: AnnotationType;
}

class SquareAnnotation extends MarkupAnnotation<SquareData> {
  constructor(params: AnnotationParameters) {
    super(params);

    const { dict, xref } = params;
    this.data.annotationType = AnnotationType.SQUARE;
    this.data.hasOwnCanvas = this.data.noRotate;
    this.data.noHTML = false;

    if (!this.appearance) {
      // The default stroke color is black.
      const strokeColor = this.color ? getPdfColorArray(this.color) : [0, 0, 0];
      const strokeAlpha = dict.getValue(DictKey.CA);

      const interiorColor = getRgbColor(dict.getArrayValue(DictKey.IC), null);
      // The default fill color is transparent.
      const fillColor = interiorColor ? getPdfColorArray(interiorColor) : null;
      const fillAlpha = fillColor ? strokeAlpha : null;

      if (this.borderStyle.width === 0 && !fillColor) {
        // Prevent rendering a "hairline" border (fixes issue14164.pdf).
        return;
      }

      this._setDefaultAppearance(
        xref,
        `${this.borderStyle.width} w`,
        strokeColor,
        fillColor,
        null,
        strokeAlpha,
        fillAlpha,
        (buffer, points) => {
          const x = points[4] + this.borderStyle.width / 2;
          const y = points[5] + this.borderStyle.width / 2;
          const width = points[6] - points[4] - this.borderStyle.width;
          const height = points[3] - points[7] - this.borderStyle.width;
          buffer.push(`${x} ${y} ${width} ${height} re`);
          if (fillColor) {
            buffer.push("B");
          } else {
            buffer.push("S");
          }
          return [points[0], points[2], points[7], points[3]];
        },
      );
    }
  }
}

export interface CircleData extends MarkupData {
  annotationType: AnnotationType;
}

class CircleAnnotation extends MarkupAnnotation<CircleData> {

  constructor(params: AnnotationParameters) {
    super(params);

    const { dict, xref } = params;
    this.data.annotationType = AnnotationType.CIRCLE;

    if (!this.appearance) {
      // The default stroke color is black.
      const strokeColor = this.color ? getPdfColorArray(this.color) : [0, 0, 0];
      const strokeAlpha = dict.getValue(DictKey.CA);

      const interiorColor = getRgbColor(dict.getArrayValue(DictKey.IC), null);
      // The default fill color is transparent.
      const fillColor = interiorColor ? getPdfColorArray(interiorColor) : null;
      const fillAlpha = fillColor ? strokeAlpha : null;

      if (this.borderStyle.width === 0 && !fillColor) {
        // Prevent rendering a "hairline" border (fixes issue14164.pdf).
        return;
      }

      // Circles are approximated by Bézier curves with four segments since
      // there is no circle primitive in the PDF specification. For the control
      // points distance, see https://stackoverflow.com/a/27863181.
      const controlPointsDistance = (4 / 3) * Math.tan(Math.PI / (2 * 4));

      this._setDefaultAppearance(
        xref,
        `${this.borderStyle.width} w`,
        strokeColor,
        fillColor,
        null,
        strokeAlpha,
        fillAlpha,
        (buffer, points) => {
          const x0 = points[0] + this.borderStyle.width / 2;
          const y0 = points[1] - this.borderStyle.width / 2;
          const x1 = points[6] - this.borderStyle.width / 2;
          const y1 = points[7] + this.borderStyle.width / 2;
          const xMid = x0 + (x1 - x0) / 2;
          const yMid = y0 + (y1 - y0) / 2;
          const xOffset = ((x1 - x0) / 2) * controlPointsDistance;
          const yOffset = ((y1 - y0) / 2) * controlPointsDistance;

          buffer.push(
            `${xMid} ${y1} m`,
            `${xMid + xOffset} ${y1} ${x1} ${yMid + yOffset} ${x1} ${yMid} c`,
            `${x1} ${yMid - yOffset} ${xMid + xOffset} ${y0} ${xMid} ${y0} c`,
            `${xMid - xOffset} ${y0} ${x0} ${yMid - yOffset} ${x0} ${yMid} c`,
            `${x0} ${yMid + yOffset} ${xMid - xOffset} ${y1} ${xMid} ${y1} c`,
            "h"
          );
          if (fillColor) {
            buffer.push("B");
          } else {
            buffer.push("S");
          }
          return [points[0], points[2], points[7], points[3]];
        },
      );
    }
  }
}

export interface PolylineData extends MarkupData {
  annotationType: AnnotationType;
  vertices: Float32Array<ArrayBuffer> | null;
  lineEndings: string[];
}

class PolylineAnnotation extends MarkupAnnotation<PolylineData> {
  constructor(params: AnnotationParameters) {
    super(params);

    const { dict, xref } = params;
    this.data.annotationType = AnnotationType.POLYLINE;
    this.data.hasOwnCanvas = this.data.noRotate;
    this.data.noHTML = false;
    this.data.vertices = null;

    if (
      PlatformHelper.isMozCental() &&
      !(this instanceof PolygonAnnotation)
    ) {
      // Only meaningful for polyline annotations.
      this.setLineEndings(dict.getArrayValue(DictKey.LE));
      this.data.lineEndings = this.lineEndings;
    }

    // The vertices array is an array of numbers representing the alternating
    // horizontal and vertical coordinates, respectively, of each vertex.
    // Convert this to an array of objects with x and y coordinates.
    const rawVertices = dict.getArrayValue(DictKey.Vertices);
    if (!isNumberArray(rawVertices, null)) {
      return;
    }
    const vertices = (this.data.vertices = Float32Array.from(rawVertices));

    if (!this.appearance) {
      // The default stroke color is black.
      const strokeColor = this.color ? getPdfColorArray(this.color) : [0, 0, 0];
      const strokeAlpha = dict.getValue(DictKey.CA);

      const borderWidth = this.borderStyle.width || 1,
        borderAdjust = 2 * borderWidth;

      // If the /Rect-entry is empty/wrong, create a fallback rectangle so that
      // we get similar rendering/highlighting behaviour as in Adobe Reader.
      const bbox = <RectType>[Infinity, Infinity, -Infinity, -Infinity];
      for (let i = 0, ii = vertices.length; i < ii; i += 2) {
        bbox[0] = Math.min(bbox[0], vertices[i] - borderAdjust);
        bbox[1] = Math.min(bbox[1], vertices[i + 1] - borderAdjust);
        bbox[2] = Math.max(bbox[2], vertices[i] + borderAdjust);
        bbox[3] = Math.max(bbox[3], vertices[i + 1] + borderAdjust);
      }
      if (!Util.intersect(this.rectangle, bbox)) {
        this.rectangle = bbox;
      }

      this._setDefaultAppearance(
        xref,
        `${borderWidth} w`,
        strokeColor,
        null,
        null,
        strokeAlpha,
        null,
        (buffer, points) => {
          for (let i = 0, ii = vertices.length; i < ii; i += 2) {
            buffer.push(
              `${vertices[i]} ${vertices[i + 1]} ${i === 0 ? "m" : "l"}`
            );
          }
          buffer.push("S");
          return [points[0], points[2], points[7], points[3]];
        },
      );
    }
  }
}

class PolygonAnnotation extends PolylineAnnotation {
  constructor(params: AnnotationParameters) {
    // Polygons are specific forms of polylines, so reuse their logic.
    super(params);

    this.data.annotationType = AnnotationType.POLYGON;
  }
}

export interface CaretData extends MarkupData {
  annotationType: AnnotationType;
}

class CaretAnnotation extends MarkupAnnotation<CaretData> {
  constructor(params: AnnotationParameters) {
    super(params);

    this.data.annotationType = AnnotationType.CARET;
  }
}

export interface InkAnnotationData extends MarkupData {
  annotationType: AnnotationType;
  inkLists: Float32Array[];
  opacity: number;
}

class InkAnnotation extends MarkupAnnotation<InkAnnotationData> {

  constructor(params: Partial<AnnotationParameters>) {
    super(<AnnotationParameters>params);

    this.data.hasOwnCanvas = this.data.noRotate;
    this.data.noHTML = false;

    const dict = params.dict!;
    const xref = params.xref!;
    this.data.annotationType = AnnotationType.INK;
    this.data.inkLists = [];
    this.data.isEditable = !this.data.noHTML && this.data.it === "InkHighlight";
    // We want to be able to add mouse listeners to the annotation.
    this.data.noHTML = false;
    this.data.opacity = dict.getValue(DictKey.CA) || 1;

    const rawInkLists = dict.getArrayValue(DictKey.InkList);
    if (!Array.isArray(rawInkLists)) {
      return;
    }
    for (let i = 0, ii = rawInkLists.length; i < ii; ++i) {
      // The raw ink lists array contains arrays of numbers representing
      // the alternating horizontal and vertical coordinates, respectively,
      // of each vertex. Convert this to an array of objects with x and y
      // coordinates.
      if (!Array.isArray(rawInkLists[i])) {
        continue;
      }
      const inkList = new Float32Array(rawInkLists[i].length);
      this.data.inkLists.push(inkList);
      for (let j = 0, jj = rawInkLists[i].length; j < jj; j += 2) {
        const x = xref.fetchIfRef(rawInkLists[i][j]),
          y = xref.fetchIfRef(rawInkLists[i][j + 1]);
        if (typeof x === "number" && typeof y === "number") {
          inkList[j] = x;
          inkList[j + 1] = y;
        }
      }
    }

    if (!this.appearance) {
      // The default stroke color is black.
      const strokeColor = this.color ? getPdfColorArray(this.color) : [0, 0, 0];
      const strokeAlpha = dict.getValue(DictKey.CA);

      const borderWidth = this.borderStyle.width || 1,
        borderAdjust = 2 * borderWidth;

      // If the /Rect-entry is empty/wrong, create a fallback rectangle so that
      // we get similar rendering/highlighting behaviour as in Adobe Reader.
      const bbox = <RectType>[Infinity, Infinity, -Infinity, -Infinity];
      for (const inkList of this.data.inkLists) {
        for (let i = 0, ii = inkList.length; i < ii; i += 2) {
          bbox[0] = Math.min(bbox[0], inkList[i] - borderAdjust);
          bbox[1] = Math.min(bbox[1], inkList[i + 1] - borderAdjust);
          bbox[2] = Math.max(bbox[2], inkList[i] + borderAdjust);
          bbox[3] = Math.max(bbox[3], inkList[i + 1] + borderAdjust);
        }
      }
      if (!Util.intersect(this.rectangle, bbox)) {
        this.rectangle = bbox;
      }

      this._setDefaultAppearance(
        xref,
        `${borderWidth} w`,
        strokeColor,
        null,
        null,
        strokeAlpha,
        null,
        (buffer, points) => {
          // According to the specification, see "12.5.6.13 Ink Annotations":
          //   When drawn, the points shall be connected by straight lines or
          //   curves in an implementation-dependent way.
          // In order to simplify things, we utilize straight lines for now.
          for (const inkList of this.data.inkLists!) {
            for (let i = 0, ii = inkList.length; i < ii; i += 2) {
              buffer.push(
                `${inkList[i]} ${inkList[i + 1]} ${i === 0 ? "m" : "l"}`
              );
            }
            buffer.push("S");
          }
          return [points[0], points[2], points[7], points[3]];
        },
      );
    }
  }

  static createNewDict(annotation: InkEditorSerial, xref: XRefImpl, apRef: Ref | null, ap: StringStream | null) {
    const { color, opacity, paths, outlines, rect, rotation, thickness } = annotation;
    const ink = new DictImpl(xref);
    ink.set(DictKey.Type, Name.get("Annot"));
    ink.set(DictKey.Subtype, Name.get("Ink"));
    ink.set(DictKey.CreationDate, `D:${getModificationDate()}`);
    ink.set(DictKey.Rect, rect);
    ink.set(DictKey.InkList, outlines?.points || paths.map(p => p.points));
    ink.set(DictKey.F, 4);
    ink.set(DictKey.Rotate, rotation);

    if (outlines) {
      // Free highlight.
      // There's nothing about this in the spec, but it's used when highlighting
      // in Edge's viewer. Acrobat takes into account this parameter to indicate
      // that the Ink is used for highlighting.
      ink.set(DictKey.IT, Name.get("InkHighlight")!);
    }

    // Line thickness.
    const bs = new DictImpl(xref);
    ink.set(DictKey.BS, bs);
    bs.set(DictKey.W, thickness);

    // Color.
    ink.set(
      DictKey.C,
      Array.from(color, (c: number) => c / 255)
    );

    // Opacity.
    ink.set(DictKey.CA, opacity);

    const n = new DictImpl(xref);
    ink.set(DictKey.AP, n);

    if (apRef) {
      n.set(DictKey.N, apRef);
    } else {
      n.set(DictKey.N, ap);
    }

    return ink;
  }

  static async createNewAppearanceStream(annotation: InkEditorSerial, xref: XRefImpl) {
    if (annotation.outlines) {
      return this.createNewAppearanceStreamForHighlight(
        annotation, xref
      );
    }
    const { color, rect, paths, thickness, opacity } = annotation;

    const appearanceBuffer = [
      `${thickness} w 1 J 1 j`,
      `${getPdfColor(color, /* isFill */ false)}`,
    ];

    if (opacity !== 1) {
      appearanceBuffer.push("/R0 gs");
    }

    const buffer = [];
    for (const { bezier } of paths) {
      buffer.length = 0;
      buffer.push(`${numberToString(bezier[0])} ${numberToString(bezier[1])} m`);
      if (bezier.length === 2) {
        buffer.push(`${numberToString(bezier[0])} ${numberToString(bezier[1])} l S`);
      } else {
        for (let i = 2, ii = bezier.length; i < ii; i += 6) {
          const curve = bezier.slice(i, i + 6).map(numberToString).join(" ");
          buffer.push(`${curve} c`);
        }
        buffer.push("S");
      }
      appearanceBuffer.push(buffer.join("\n"));
    }
    const appearance = appearanceBuffer.join("\n");

    const appearanceStreamDict = new DictImpl(xref);
    appearanceStreamDict.set(DictKey.FormType, 1);
    appearanceStreamDict.set(DictKey.Subtype, Name.get("Form"));
    appearanceStreamDict.set(DictKey.Type, Name.get("XObject"));
    appearanceStreamDict.set(DictKey.BBox, rect);
    appearanceStreamDict.set(DictKey.Length, appearance.length);

    if (opacity !== 1) {
      const resources = new DictImpl(xref);
      const extGState = new DictImpl(xref);
      const r0 = new DictImpl(xref);
      r0.set(DictKey.CA, opacity);
      r0.set(DictKey.Type, Name.get("ExtGState"));
      extGState.set(DictKey.R0, r0);
      resources.set(DictKey.ExtGState, extGState);
      appearanceStreamDict.set(DictKey.Resources, resources);
    }

    const ap = new StringStream(appearance);
    ap.dict = appearanceStreamDict;

    return ap;
  }

  static async createNewAppearanceStreamForHighlight(annotation: InkEditorSerial, xref: XRefImpl) {
    const { color, rect, opacity } = annotation;
    const outline = annotation.outlines!.outline!;
    const appearanceBuffer = [`${getPdfColor(color, true)}`, "/R0 gs",];

    appearanceBuffer.push(
      `${numberToString(outline[4])} ${numberToString(outline[5])} m`
    );
    for (let i = 6, ii = outline.length; i < ii; i += 6) {
      if (isNaN(outline[i]) || outline[i] === null) {
        appearanceBuffer.push(
          `${numberToString(outline[i + 4])} ${numberToString(outline[i + 5])} l`
        );
      } else {
        const curve = outline
          .slice(i, i + 6)
          .map(numberToString)
          .join(" ");
        appearanceBuffer.push(`${curve} c`);
      }
    }
    appearanceBuffer.push("h f");
    const appearance = appearanceBuffer.join("\n");

    const appearanceStreamDict = new DictImpl(xref);
    appearanceStreamDict.set(DictKey.FormType, 1);
    appearanceStreamDict.set(DictKey.Subtype, Name.get("Form"));
    appearanceStreamDict.set(DictKey.Type, Name.get("XObject"));
    appearanceStreamDict.set(DictKey.BBox, rect);
    appearanceStreamDict.set(DictKey.Length, appearance.length);

    const resources = new DictImpl(xref);
    const extGState = new DictImpl(xref);
    resources.set(DictKey.ExtGState, extGState);
    appearanceStreamDict.set(DictKey.Resources, resources);
    const r0 = new DictImpl(xref);
    extGState.set(DictKey.R0, r0);
    r0.set(DictKey.BM, Name.get("Multiply")!);

    if (opacity !== 1) {
      r0.set(DictKey.ca, opacity);
      r0.set(DictKey.Type, Name.get("ExtGState"));
    }

    const ap = new StringStream(appearance);
    ap.dict = appearanceStreamDict;

    return ap;
  }
}

export interface HighlightData extends MarkupData {
  annotationType: AnnotationType;
  opacity: number;
}

class HighlightAnnotation extends MarkupAnnotation<HighlightData> {

  constructor(params: Partial<AnnotationParameters>) {
    super(<AnnotationParameters>params);

    const dict = params.dict!
    const xref = params.xref!;
    this.data.annotationType = AnnotationType.HIGHLIGHT;
    this.data.isEditable = !this.data.noHTML;
    // We want to be able to add mouse listeners to the annotation.
    this.data.noHTML = false;
    this.data.opacity = dict.getValue(DictKey.CA) || 1;

    const quadPoints = (this.data.quadPoints = getQuadPoints(dict, null) ?? undefined);
    if (quadPoints) {
      const resources = this.appearance?.dict?.getValue(DictKey.Resources);

      if (!this.appearance || !resources?.has(DictKey.ExtGState)) {
        if (this.appearance) {
          // Workaround for cases where there's no /ExtGState-entry directly
          // available, e.g. when the appearance stream contains a /XObject of
          // the /Form-type, since that causes the highlighting to completely
          // obscure the PDF content below it (fixes issue13242.pdf).
          warn("HighlightAnnotation - ignoring built-in appearance stream.");
        }
        // Default color is yellow in Acrobat Reader
        const fillColor = this.color ? getPdfColorArray(this.color) : [1, 1, 0];
        const fillAlpha = dict.getValue(DictKey.CA);

        this._setDefaultAppearance(
          xref,
          null,
          null,
          fillColor,
          "Multiply",
          null,
          fillAlpha,
          (buffer, points) => {
            buffer.push(
              `${points[0]} ${points[1]} m`,
              `${points[2]} ${points[3]} l`,
              `${points[6]} ${points[7]} l`,
              `${points[4]} ${points[5]} l`,
              "f"
            );
            return [points[0], points[2], points[7], points[3]];
          },
        );
      }
    } else {
      this.data.popupRef = null;
    }
  }

  static createNewDict(annotation: HighlightEditorSerial, xref: XRefImpl, apRef: Ref | null, ap: StringStream | null) {

    const { color, oldAnnotation, opacity, rect, rotation, user, quadPoints } = annotation;
    const highlight = oldAnnotation || new DictImpl(xref);

    highlight.set(DictKey.Type, Name.get("Annot"));
    highlight.set(DictKey.Subtype, Name.get("Highlight"));
    highlight.set(oldAnnotation ? DictKey.M : DictKey.CreationDate, `D:${getModificationDate()}`);
    highlight.set(DictKey.CreationDate, `D:${getModificationDate()}`);
    highlight.set(DictKey.Rect, rect);
    highlight.set(DictKey.F, 4);
    highlight.set(DictKey.Border, [0, 0, 0]);
    highlight.set(DictKey.Rotate, rotation);
    highlight.set(DictKey.QuadPoints, quadPoints);

    // Color.
    highlight.set(DictKey.C, Array.from(color, (c: number) => c / 255));

    // Opacity.
    highlight.set(DictKey.CA, opacity);

    if (user) {
      highlight.set(DictKey.T, stringToAsciiOrUTF16BE(user));
    }

    if (apRef || ap) {
      const n = new DictImpl(xref);
      highlight.set(DictKey.AP, n);
      n.set(DictKey.N, apRef || ap!);
    }

    return highlight;
  }

  static async createNewAppearanceStream(annotation: HighlightEditorSerial, xref: XRefImpl) {

    const { color, rect, outlines, opacity } = annotation;
    const appearanceBuffer = [`${getPdfColor(color!, true)}`, "/R0 gs"];

    const buffer = [];
    for (const outline of outlines) {
      buffer.length = 0;
      buffer.push(`${numberToString(outline[0])} ${numberToString(outline[1])} m`);
      for (let i = 2, ii = outline.length; i < ii; i += 2) {
        buffer.push(`${numberToString(outline[i])} ${numberToString(outline[i + 1])} l`);
      }
      buffer.push("h");
      appearanceBuffer.push(buffer.join("\n"));
    }
    appearanceBuffer.push("f*");
    const appearance = appearanceBuffer.join("\n");

    const appearanceStreamDict = new DictImpl(xref);
    appearanceStreamDict.set(DictKey.FormType, 1);
    appearanceStreamDict.set(DictKey.Subtype, Name.get("Form"));
    appearanceStreamDict.set(DictKey.Type, Name.get("XObject"));
    appearanceStreamDict.set(DictKey.BBox, rect!);
    appearanceStreamDict.set(DictKey.Length, appearance.length);

    const resources = new DictImpl(xref);
    const extGState = new DictImpl(xref);
    resources.set(DictKey.ExtGState, extGState);
    appearanceStreamDict.set(DictKey.Resources, resources);
    const r0 = new DictImpl(xref);
    extGState.set(DictKey.R0, r0);
    r0.set(DictKey.BM, Name.get("Multiply")!);

    if (opacity !== 1) {
      r0.set(DictKey.ca, opacity);
      r0.set(DictKey.Type, Name.get("ExtGState"));
    }

    const ap = new StringStream(appearance);
    ap.dict = appearanceStreamDict;

    return ap;
  }
}

export interface UnderlineData extends MarkupData {
  annotationType: AnnotationType;
}

class UnderlineAnnotation extends MarkupAnnotation<UnderlineData> {
  constructor(params: AnnotationParameters) {
    super(params);

    const { dict, xref } = params;
    this.data.annotationType = AnnotationType.UNDERLINE;

    const quadPoints = (this.data.quadPoints = getQuadPoints(dict, null) ?? undefined);
    if (quadPoints) {
      if (!this.appearance) {
        // Default color is black
        const strokeColor = this.color ? getPdfColorArray(this.color) : [0, 0, 0];
        const strokeAlpha = dict.getValue(DictKey.CA);

        // The values 0.571 and 1.3 below corresponds to what Acrobat is doing.
        this._setDefaultAppearance(
          xref,
          "[] 0 d 0.571 w",
          strokeColor,
          null,
          null,
          strokeAlpha,
          null,
          (buffer, points) => {
            buffer.push(
              `${points[4]} ${points[5] + 1.3} m`,
              `${points[6]} ${points[7] + 1.3} l`,
              "S"
            );
            return [points[0], points[2], points[7], points[3]];
          }
        );
      }
    } else {
      this.data.popupRef = null;
    }
  }
}

export interface SquigglyData extends MarkupData {
  annotationType: AnnotationType;
}

class SquigglyAnnotation extends MarkupAnnotation<SquigglyData> {
  constructor(params: AnnotationParameters) {
    super(params);

    const { dict, xref } = params;
    this.data.annotationType = AnnotationType.SQUIGGLY;

    const quadPoints = (this.data.quadPoints = getQuadPoints(dict, null) ?? undefined);
    if (quadPoints) {
      if (!this.appearance) {
        // Default color is black
        const strokeColor = this.color
          ? getPdfColorArray(this.color)
          : [0, 0, 0];
        const strokeAlpha = dict.getValue(DictKey.CA);

        this._setDefaultAppearance(
          xref,
          "[] 0 d 1 w",
          strokeColor,
          null, null,
          strokeAlpha,
          null,
          (buffer, points) => {
            const dy = (points[1] - points[5]) / 6;
            let shift = dy;
            let x = points[4];
            const y = points[5];
            const xEnd = points[6];
            buffer.push(`${x} ${y + shift} m`);
            do {
              x += 2;
              shift = shift === 0 ? dy : 0;
              buffer.push(`${x} ${y + shift} l`);
            } while (x < xEnd);
            buffer.push("S");
            return [points[4], xEnd, y - 2 * dy, y + 2 * dy];
          },
        );
      }
    } else {
      this.data.popupRef = null;
    }
  }
}

export interface StrikeOutData extends MarkupData {
  annotationType: AnnotationType;
}

class StrikeOutAnnotation extends MarkupAnnotation<StrikeOutData> {
  constructor(params: AnnotationParameters) {
    super(params);

    const { dict, xref } = params;
    this.data.annotationType = AnnotationType.STRIKEOUT;

    const quadPoints = (this.data.quadPoints = getQuadPoints(dict, null) ?? undefined);
    if (quadPoints) {
      if (!this.appearance) {
        // Default color is black
        const strokeColor = this.color ? getPdfColorArray(this.color) : [0, 0, 0];
        const strokeAlpha = dict.getValue(DictKey.CA);

        this._setDefaultAppearance(
          xref, "[] 0 d 1 w", strokeColor, null, null, strokeAlpha, null, (buffer, points) => {
            buffer.push(
              `${(points[0] + points[4]) / 2} ` +
              `${(points[1] + points[5]) / 2} m`,
              `${(points[2] + points[6]) / 2} ` +
              `${(points[3] + points[7]) / 2} l`,
              "S"
            );
            return [points[0], points[2], points[7], points[3]];
          },
        );
      }
    } else {
      this.data.popupRef = null;
    }
  }
}

export interface StampData extends MarkupData {
  annotationType: AnnotationType;
}

class StampAnnotation extends MarkupAnnotation<StampData> {

  public refToReplace: Ref | null = null;

  public ref: Ref | null = null;

  #savedHasOwnCanvas;

  constructor(partialParams: Partial<AnnotationParameters>) {
    const params = <AnnotationParameters>partialParams;
    super(params);

    this.data.annotationType = AnnotationType.STAMP;
    this.#savedHasOwnCanvas = this.data.hasOwnCanvas = this.data.noRotate;
    this.data.isEditable = !this.data.noHTML;
    // We want to be able to add mouse listeners to the annotation.
    this.data.noHTML = false;
  }

  mustBeViewedWhenEditing(isEditing: boolean, modifiedIds: Set<string> | null = null) {
    if (isEditing) {
      if (!this.data.isEditable) {
        return false;
      }
      // When we're editing, we want to ensure that the stamp annotation is
      // drawn on a canvas in order to use it in the annotation editor layer.
      this.#savedHasOwnCanvas = this.data.hasOwnCanvas;
      this.data.hasOwnCanvas = true;
      return true;
    }
    this.data.hasOwnCanvas = this.#savedHasOwnCanvas;

    return !modifiedIds?.has(this.data.id);
  }

  static async createImage(bitmap: HTMLImageElement, xref: XRefImpl): Promise<CreateStampImageResult> {
    // TODO: when printing, we could have a specific internal colorspace
    // (e.g. something like DeviceRGBA) in order avoid any conversion (i.e. no
    // jpeg, no rgba to rgb conversion, etc...)

    const { width, height } = bitmap;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d", { alpha: true })!;

    // Draw the image and get the data in order to extract the transparency.
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, width, height).data;
    const buf32 = new Uint32Array(data.buffer);
    const hasAlpha = buf32.some(
      FeatureTest.isLittleEndian ? x => x >>> 24 !== 0xff : x => (x & 0xff) !== 0xff
    );

    if (hasAlpha) {
      // Redraw the image on a white background in order to remove the thin gray
      // line which can appear when exporting to jpeg.
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0);
    }

    const jpegBufferPromise = canvas.convertToBlob({ type: "image/jpeg", quality: 1 })
      .then(blob => blob.arrayBuffer());

    const xobjectName = Name.get("XObject");
    const imageName = Name.get("Image");
    const image = new DictImpl(xref);
    image.set(DictKey.Type, xobjectName);
    image.set(DictKey.Subtype, imageName);
    image.set(DictKey.BitsPerComponent, 8);
    image.set(DictKey.ColorSpace, Name.get("DeviceRGB")!);
    image.set(DictKey.Filter, Name.get("DCTDecode")!);
    image.set(DictKey.BBox, [0, 0, width, height]);
    image.set(DictKey.Width, width);
    image.set(DictKey.Height, height);

    let smaskStream = null;
    if (hasAlpha) {
      const alphaBuffer = new Uint8Array(buf32.length);
      if (FeatureTest.isLittleEndian) {
        for (let i = 0, ii = buf32.length; i < ii; i++) {
          alphaBuffer[i] = buf32[i] >>> 24;
        }
      } else {
        for (let i = 0, ii = buf32.length; i < ii; i++) {
          alphaBuffer[i] = buf32[i] & 0xff;
        }
      }

      const smask = new DictImpl(xref);
      smask.set(DictKey.Type, xobjectName);
      smask.set(DictKey.Subtype, imageName);
      smask.set(DictKey.BitsPerComponent, 8);
      smask.set(DictKey.ColorSpace, Name.get("DeviceGray")!);
      smask.set(DictKey.Width, width);
      smask.set(DictKey.Height, height);

      smaskStream = new Stream(alphaBuffer, 0, 0, smask);
    }
    const imageStream = new Stream(await jpegBufferPromise, 0, 0, image);

    return {
      imageStream,
      smaskStream,
      width,
      height,
    };
  }

  static createNewDict(annotation: StampEditorSerial, xref: XRefImpl, apRef: Ref | null, ap: StringStream | null) {

    const { oldAnnotation, rect, rotation, user } = annotation;
    const stamp = oldAnnotation || new DictImpl(xref);
    stamp.set(DictKey.Type, Name.get("Annot"));
    stamp.set(DictKey.Subtype, Name.get("Stamp"));
    stamp.set(oldAnnotation ? DictKey.M : DictKey.CreationDate, `D:${getModificationDate()}`
    );
    stamp.set(DictKey.CreationDate, `D:${getModificationDate()}`);
    stamp.set(DictKey.Rect, rect);
    stamp.set(DictKey.F, 4);
    stamp.set(DictKey.Border, [0, 0, 0]);
    stamp.set(DictKey.Rotate, rotation);

    if (user) {
      stamp.set(DictKey.T, stringToAsciiOrUTF16BE(user));
    }

    if (apRef || ap) {
      const n = new DictImpl(xref);
      stamp.set(DictKey.AP, n);

      if (apRef) {
        n.set(DictKey.N, apRef);
      } else {
        n.set(DictKey.N, ap);
      }
    }

    return stamp;
  }

  static async createNewAppearanceStream(annotation: StampEditorSerial, xref: XRefImpl, image: CreateStampImageResult) {
    if (annotation.oldAnnotation) {
      // We'll use the AP we already have.
      return null;
    }

    const { rotation } = annotation;
    const { imageRef, width, height } = image;
    const resources = new DictImpl(xref);
    const xobject = new DictImpl(xref);
    resources.set(DictKey.XObject, xobject);
    xobject.set(DictKey.Im0, <Ref>imageRef!);
    const appearance = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`;

    const appearanceStreamDict = new DictImpl(xref);
    appearanceStreamDict.set(DictKey.FormType, 1);
    appearanceStreamDict.set(DictKey.Subtype, Name.get("Form"));
    appearanceStreamDict.set(DictKey.Type, Name.get("XObject"));
    appearanceStreamDict.set(DictKey.BBox, [0, 0, width, height]);
    appearanceStreamDict.set(DictKey.Resources, resources);

    if (rotation) {
      const matrix = getRotationMatrix(rotation, width, height);
      appearanceStreamDict.set(DictKey.Matrix, matrix);
    }

    const ap = new StringStream(appearance);
    ap.dict = appearanceStreamDict;

    return ap;
  }
}

export interface FileAttachmentData extends MarkupData {
  fillAlpha: number | null;
  name: string;
  file: FileSpecSerializable;
  annotationType: AnnotationType;
}

class FileAttachmentAnnotation extends MarkupAnnotation<FileAttachmentData> {
  constructor(params: AnnotationParameters) {
    super(params);

    const { dict, xref } = params;
    const file = new FileSpec(<Dict>dict.getValue(DictKey.FS), xref);

    this.data.annotationType = AnnotationType.FILEATTACHMENT;
    this.data.hasOwnCanvas = this.data.noRotate;
    this.data.noHTML = false;
    this.data.file = file.serializable;

    const name = dict.getValue(DictKey.Name);
    this.data.name = name instanceof Name ? stringToPDFString(name.name) : "PushPin";

    const fillAlpha = dict.getValue(DictKey.ca);
    this.data.fillAlpha = typeof fillAlpha === "number" && fillAlpha >= 0 && fillAlpha <= 1
      ? fillAlpha : null;
  }
}
