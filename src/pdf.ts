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

import {
  AbortException,
  AnnotationEditorParamsType,
  AnnotationEditorType,
  AnnotationMode,
  createValidAbsoluteUrl,
  FeatureTest,
  ImageKind,
  InvalidPDFException,
  MissingPDFException,
  normalizeUnicode,
  OPS,
  PasswordResponses,
  PermissionFlag,
  shadow,
  UnexpectedResponseException,
  Util,
  VerbosityLevel,
} from "./shared/util";
import {
  build,
  getDocument,
  PDFDataRangeTransport,
  PDFWorker,
  version,
} from "./display/api";
import {
  fetchData,
  getFilenameFromUrl,
  getPdfFilenameFromUrl,
  isDataScheme,
  isPdfFile,
  noContextMenu,
  OutputScale,
  PDFDateString,
  PixelsPerInch,
  RenderingCancelledException,
  setLayerDimensions,
} from "./display/display_utils";
import { AnnotationEditorLayer } from "./display/editor/annotation_editor_layer";
import { AnnotationEditorUIManager } from "./display/editor/tools";
import { AnnotationLayer } from "./display/annotation_layer";
import { ColorPicker } from "./display/editor/color_picker";
import { DOMSVGFactory } from "./display/svg_factory";
import { DrawLayer } from "./display/draw_layer";
import { GlobalWorkerOptions } from "./display/worker_options";
import { HighlightOutliner } from "./display/editor/drawers/highlight";
import { TextLayer } from "./display/text_layer";
import { PlatformHelper } from "./platform/platform_helper";


//@ts-ignore
const pdfjsVersion = PlatformHelper.hasDefined() ? PlatformHelper.bundleVersion() : void 0;

//@ts-ignore
const pdfjsBuild = PlatformHelper.hasDefined() ? PlatformHelper.bundleBuild() : void 0;

if (PlatformHelper.isTesting()) {
  (globalThis as any).pdfjsTestingUtils = {
    HighlightOutliner,
  };
}

export {
  AbortException,
  AnnotationEditorLayer,
  AnnotationEditorParamsType,
  AnnotationEditorType,
  AnnotationEditorUIManager,
  AnnotationLayer,
  AnnotationMode,
  build,
  ColorPicker,
  createValidAbsoluteUrl,
  DOMSVGFactory,
  DrawLayer,
  FeatureTest,
  fetchData,
  getDocument,
  getFilenameFromUrl,
  getPdfFilenameFromUrl,
  GlobalWorkerOptions,
  ImageKind,
  InvalidPDFException,
  isDataScheme,
  isPdfFile,
  MissingPDFException,
  noContextMenu,
  normalizeUnicode,
  OPS,
  OutputScale,
  PasswordResponses,
  PDFDataRangeTransport,
  PDFDateString,
  PDFWorker,
  PermissionFlag,
  PixelsPerInch,
  RenderingCancelledException,
  setLayerDimensions,
  shadow,
  TextLayer,
  UnexpectedResponseException,
  Util,
  VerbosityLevel,
  version
};
