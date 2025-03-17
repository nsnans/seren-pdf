/* Copyright 2018 Mozilla Foundation
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

import { ThemeMode, AnnotationMode, isNull } from "seren-common";
import { DEFAULT_SCALE, MAX_SCALE, MIN_SCALE } from "seren-viewer";

enum OptionKind {
  BROWSER = 0x01,
  VIEWER = 0x02,
  API = 0x04,
  WORKER = 0x08,
  EVENT_DISPATCH = 0x10,
  PREFERENCE = 0x80,
};

// Should only be used with options that allow multiple types.
const Type = {
  BOOLEAN: 0x01,
  NUMBER: 0x02,
  OBJECT: 0x04,
  STRING: 0x08,
  UNDEFINED: 0x10,
};

/**
 * 定义了一个接口，然后默认的实现这个接口，初始化参数拿这个接口。
 * 应该给每个对象都加上详细的说明 
 */
export interface WebPDFViewerOptions {
  viewerScale: number;
  allowedGlobalEvents: string[];
  canvasMaxAreaInBytes: number;
  isInAutomation: boolean;
  localeProperties: { lang: string }
  nimbusDataStr: string;
  supportsCaretBrowsingMode: boolean;
  supportsDocumentFonts: boolean;
  supportsIntegratedFind: boolean;
  supportsMouseWheelZoomCtrlKey: boolean;
  supportsMouseWheelZoomMetaKey: boolean;
  supportsPinchToZoom: boolean;
  toolbarDensity: number;
  altTextLearnMoreUrl: string;
  annotationEditorMode: number;
  annotationMode: AnnotationMode;
  cursorToolOnLoad: number;
  defaultZoomDelay: number;
  defaultZoomValue: string;
  disableHistory: boolean;
  disablePageLabels: boolean;
  enableAltText: boolean;
  enableAltTextModelDownload: boolean;
  enableGuessAltText: boolean;
  enableHighlightFloatingButton: boolean;
  enableNewAltTextWhenAddingImage: boolean;
  enablePermissions: boolean;
  enablePrintAutoRotate: boolean;
  enableScripting: boolean;
  enableThumbnailView: boolean,
  enableUpdatedAddImage: boolean;
  externalLinkRel: string;
  externalLinkTarget: number;
  highlightEditorColors: string;
  historyUpdateUrl: boolean;
  ignoreDestinationZoom: boolean;
  imageResourcesPath: string;
  maxCanvasPixels: number;
  forcePageColors: boolean;
  pageColorsBackground: string;
  pageColorsForeground: string;
  printResolution: number;
  sidebarViewOnLoad: number;
  scrollModeOnLoad: number;
  spreadModeOnLoad: number;
  textLayerMode: number;
  viewOnLoad: number;
  cMapPacked: boolean;
  cMapUrl: string;
  disableAutoFetch: boolean;
  disableFontFace: boolean;
  disableRange: boolean;
  disableStream: boolean;
  docBaseUrl: string;
  enableHWA: boolean;
  fontExtraProperties: boolean;
  isEvalSupported: boolean;
  isOffscreenCanvasSupported: boolean;
  maxImageSize: number;
  standardFontDataUrl: string;
  useSystemFonts: boolean;
  verbosity: number;
  workPorter: null;
  workerSrc: string | null;
  viewerCssTheme: ThemeMode;
  enableFakeMLManager: boolean;
  disablePreferences: boolean;
}
export function defaultWebViewerOptions(): WebPDFViewerOptions {
  return {
    viewerScale: DEFAULT_SCALE,
    allowedGlobalEvents: [],
    canvasMaxAreaInBytes: -1,
    isInAutomation: false,
    localeProperties: { lang: "zh-cn" },
    nimbusDataStr: "",
    supportsCaretBrowsingMode: false,
    supportsDocumentFonts: true,
    supportsIntegratedFind: false,
    supportsMouseWheelZoomCtrlKey: true,
    supportsMouseWheelZoomMetaKey: true,
    supportsPinchToZoom: true,
    toolbarDensity: 0, // 0 = "normal", 1 = "compact", 2 = "touch" 后面改成枚举
    altTextLearnMoreUrl: "",
    annotationEditorMode: 0,
    annotationMode: AnnotationMode.ENABLE_FORMS,
    cursorToolOnLoad: 2,
    defaultZoomDelay: 400,
    defaultZoomValue: "",
    disableHistory: false,
    disablePageLabels: false,
    enableAltText: false,
    enableAltTextModelDownload: true,
    enableGuessAltText: true,
    enableHighlightFloatingButton: false,
    enableNewAltTextWhenAddingImage: true,
    enablePermissions: false,
    enablePrintAutoRotate: true,
    enableScripting: false,
    enableThumbnailView: true,
    enableUpdatedAddImage: false,
    externalLinkRel: "noopener noreferrer nofollow",
    externalLinkTarget: 0,
    highlightEditorColors: "yellow=#FFFF98,green=#53FFBC,blue=#80EBFF,pink=#FFCBE6,red=#FF4F5F",
    historyUpdateUrl: false,
    ignoreDestinationZoom: false,
    imageResourcesPath: "",
    maxCanvasPixels: 2 ** 25,
    forcePageColors: false,
    pageColorsBackground: "Canvas",
    pageColorsForeground: "CanvasText",
    printResolution: 150,
    sidebarViewOnLoad: -1,
    scrollModeOnLoad: -1,
    spreadModeOnLoad: -1,
    textLayerMode: 1,
    viewOnLoad: 0,
    cMapPacked: true,
    cMapUrl: "../external/bcmaps/",
    disableAutoFetch: false,
    disableFontFace: false,
    disableRange: false,
    disableStream: false,
    docBaseUrl: "",
    enableHWA: true,
    fontExtraProperties: false,
    isEvalSupported: true,
    isOffscreenCanvasSupported: true,
    maxImageSize: -1,
    standardFontDataUrl: "../external/standard_fonts/",
    // On Android, there is almost no chance to have the font we want so we
    // don't use the system fonts in this case (bug 1882613).
    useSystemFonts: true,
    verbosity: 1,
    workPorter: null,
    workerSrc: "",
    viewerCssTheme: ThemeMode.DARK_MODE,
    enableFakeMLManager: true,
    disablePreferences: false
  };
}

export class WebPDFViewerGeneralOptions implements WebPDFViewerOptions {

  protected readonly _allowedGlobalEvents = { value: <string[] | null>null, kind: OptionKind.BROWSER }

  protected readonly _canvasMaxAreaInBytes = { value: <number | null>null, kind: OptionKind.BROWSER + OptionKind.API }

  protected readonly _isInAutomation = { value: <boolean | null>null, kind: OptionKind.BROWSER }

  protected readonly _localeProperties = { value: <{ lang: string } | null>null, kind: OptionKind.BROWSER }

  protected readonly _nimbusDataStr = { value: <string | null>null, kind: OptionKind.BROWSER }

  protected readonly _supportsCaretBrowsingMode = { value: <boolean | null>null, kind: OptionKind.BROWSER }

  protected readonly _supportsDocumentFonts = { value: <boolean | null>null, kind: OptionKind.BROWSER }

  protected readonly _supportsIntegratedFind = { value: <boolean | null>null, kind: OptionKind.BROWSER }

  protected readonly _supportsMouseWheelZoomCtrlKey = { value: <boolean | null>null, kind: OptionKind.BROWSER }

  protected readonly _supportsMouseWheelZoomMetaKey = { value: <boolean | null>null, kind: OptionKind.BROWSER }

  protected readonly _supportsPinchToZoom = { value: <boolean | null>null, kind: OptionKind.BROWSER }

  protected readonly _toolbarDensity = { value: <number | null>null, kind: OptionKind.BROWSER + OptionKind.EVENT_DISPATCH }

  protected readonly _altTextLearnMoreUrl = { value: <string | null>null, kind: OptionKind.VIEWER + OptionKind.PREFERENCE }

  protected readonly _annotationEditorMode = { value: <number | null>null, kind: OptionKind.VIEWER + OptionKind.PREFERENCE }

  protected readonly _annotationMode = { value: <number | null>null, kind: OptionKind.VIEWER + OptionKind.PREFERENCE }

  protected readonly _cursorToolOnLoad = { value: <number | null>null, kind: OptionKind.VIEWER + OptionKind.PREFERENCE }

  protected readonly _defaultZoomDelay = { value: <number | null>null, kind: OptionKind.VIEWER + OptionKind.PREFERENCE }

  protected readonly _defaultZoomValue = { value: <string | null>null, kind: OptionKind.VIEWER + OptionKind.PREFERENCE }

  protected readonly _disableHistory = { value: <boolean | null>null, kind: OptionKind.VIEWER }

  protected readonly _disablePageLabels = { value: <boolean | null>null, kind: OptionKind.VIEWER + OptionKind.PREFERENCE }

  protected readonly _enableAltText = { value: <boolean | null>null, kind: OptionKind.VIEWER + OptionKind.PREFERENCE }

  protected readonly _enableAltTextModelDownload = { value: <boolean | null>null, kind: OptionKind.VIEWER + OptionKind.PREFERENCE + OptionKind.EVENT_DISPATCH }

  protected readonly _enableGuessAltText = { value: <boolean | null>null, kind: OptionKind.VIEWER + OptionKind.PREFERENCE + OptionKind.EVENT_DISPATCH }

  protected readonly _enableHighlightFloatingButton = { value: <boolean | null>null, kind: OptionKind.VIEWER + OptionKind.PREFERENCE }

  protected readonly _enableNewAltTextWhenAddingImage = { value: <boolean | null>null, kind: OptionKind.VIEWER + OptionKind.PREFERENCE }

  protected readonly _enablePermissions = { value: <boolean | null>null, kind: OptionKind.VIEWER + OptionKind.PREFERENCE }

  protected readonly _enablePrintAutoRotate = { value: <boolean | null>null, kind: OptionKind.VIEWER + OptionKind.PREFERENCE }

  protected readonly _enableScripting = { value: <boolean | null>null, kind: OptionKind.VIEWER + OptionKind.PREFERENCE }

  protected readonly _enableThumbnailView = { value: <boolean | null>null, kind: OptionKind.VIEWER }

  protected readonly _enableUpdatedAddImage = { value: <boolean | null>null, kind: OptionKind.VIEWER + OptionKind.PREFERENCE }

  protected readonly _externalLinkRel = { value: <string | null>null, kind: OptionKind.VIEWER }

  protected readonly _externalLinkTarget = { value: <number | null>null, kind: OptionKind.VIEWER + OptionKind.PREFERENCE }

  protected readonly _highlightEditorColors = { value: <string | null>null, kind: OptionKind.VIEWER + OptionKind.PREFERENCE }

  protected readonly _historyUpdateUrl = { value: <boolean | null>null, kind: OptionKind.VIEWER + OptionKind.PREFERENCE }

  protected readonly _ignoreDestinationZoom = { value: <boolean | null>null, kind: OptionKind.VIEWER + OptionKind.PREFERENCE }

  protected readonly _imageResourcesPath = { value: <string | null>null, kind: OptionKind.VIEWER }

  protected readonly _maxCanvasPixels = { value: <number | null>null, kind: OptionKind.VIEWER }

  protected readonly _forcePageColors = { value: <boolean | null>null, kind: OptionKind.VIEWER + OptionKind.PREFERENCE }

  protected readonly _pageColorsBackground = { value: <string | null>null, kind: OptionKind.VIEWER + OptionKind.PREFERENCE }

  protected readonly _pageColorsForeground = { value: <string | null>null, kind: OptionKind.VIEWER + OptionKind.PREFERENCE }

  protected readonly _printResolution = { value: <number | null>null, kind: OptionKind.VIEWER }

  protected readonly _sidebarViewOnLoad = { value: <number | null>null, kind: OptionKind.VIEWER + OptionKind.PREFERENCE }

  protected readonly _scrollModeOnLoad = { value: <number | null>null, kind: OptionKind.VIEWER + OptionKind.PREFERENCE }

  protected readonly _spreadModeOnLoad = { value: <number | null>null, kind: OptionKind.VIEWER + OptionKind.PREFERENCE }

  protected readonly _textLayerMode = { value: <number | null>null, kind: OptionKind.VIEWER + OptionKind.PREFERENCE }

  protected readonly _viewOnLoad = { value: <number | null>null, kind: OptionKind.VIEWER + OptionKind.PREFERENCE }

  protected readonly _cMapPacked = { value: <boolean | null>null, kind: OptionKind.API }

  protected readonly _cMapUrl = { value: <string | null>null, kind: OptionKind.API }

  protected readonly _disableAutoFetch = { value: <boolean | null>null, kind: OptionKind.API + OptionKind.PREFERENCE }

  protected readonly _disableFontFace = { value: <boolean | null>null, kind: OptionKind.API + OptionKind.PREFERENCE }

  protected readonly _disableRange = { value: <boolean | null>null, kind: OptionKind.API + OptionKind.PREFERENCE }

  protected readonly _disableStream = { value: <boolean | null>null, kind: OptionKind.API + OptionKind.PREFERENCE }

  protected readonly _docBaseUrl = { value: <string | null>null, kind: OptionKind.API }

  protected readonly _enableHWA = { value: <boolean | null>null, kind: OptionKind.API + OptionKind.VIEWER + OptionKind.PREFERENCE }

  protected readonly _fontExtraProperties = { value: <boolean | null>null, kind: OptionKind.API, }

  protected readonly _isEvalSupported = { value: <boolean | null>null, kind: OptionKind.API }

  protected readonly _isOffscreenCanvasSupported = { value: <boolean | null>null, kind: OptionKind.API }

  protected readonly _maxImageSize = { value: <number | null>null, kind: OptionKind.API, }

  protected readonly _standardFontDataUrl = { value: <string | null>null, kind: OptionKind.API }

  protected readonly _useSystemFonts = { value: <boolean | null>null, kind: OptionKind.API, type: Type.BOOLEAN + Type.UNDEFINED }

  protected readonly _verbosity = { value: <number | null>null, kind: OptionKind.API }

  protected readonly _workerPort = { value: null, kind: OptionKind.WORKER }

  protected readonly _workerSrc = { value: <string | null>null, kind: OptionKind.WORKER }

  protected readonly _viewerCssTheme = { value: <ThemeMode | null>null, kind: OptionKind.VIEWER + OptionKind.PREFERENCE }

  protected readonly _enableFakeMLManager = { value: <boolean | null>null, kind: OptionKind.VIEWER }

  protected readonly _disablePreferences = { value: <boolean | null>null, kind: OptionKind.VIEWER }

  protected readonly _viewerScale = { value: DEFAULT_SCALE, kind: OptionKind.VIEWER };

  constructor(options: Partial<WebPDFViewerOptions>) {
    const overrideOptions: WebPDFViewerOptions = { ...defaultWebViewerOptions(), ...options };
    for (const [key, value] of Object.entries(overrideOptions)) {
      if (key.startsWith("_")) {
        throw new Error("无法将属性值赋给受保护的变量");
      }
      (<Record<string, unknown>>this)[key] = value;
    }
  }
  get viewerScale(): number {
    return this._viewerScale.value;
  }

  set viewerScale(newScale: number) {
    if (isNull(newScale) || newScale > MAX_SCALE || newScale < MIN_SCALE) {
      throw new Error("PDF阅读器的缩放，应当在[" + MIN_SCALE + "," + MAX_SCALE + "]范围之内。")
    }
    this._viewerScale.value = newScale;
  }

  get allowedGlobalEvents(): string[] {
    return this._allowedGlobalEvents.value!;
  }

  set allowedGlobalEvents(value: string[]) {
    this._allowedGlobalEvents.value = value;
  }

  get canvasMaxAreaInBytes(): number {
    return this._canvasMaxAreaInBytes.value!;
  }

  set canvasMaxAreaInBytes(value: number) {
    this._canvasMaxAreaInBytes.value = value;
  }

  get isInAutomation(): boolean {
    return this._isInAutomation.value!;
  }

  set isInAutomation(value: boolean) {
    this._isInAutomation.value = value;
  }

  get localeProperties(): { lang: string } {
    return this._localeProperties.value!;
  }

  set localeProperties(value: { lang: string }) {
    this._localeProperties.value = value;
  }

  get nimbusDataStr(): string {
    return this._nimbusDataStr.value!;
  }

  set nimbusDataStr(value: string) {
    this._nimbusDataStr.value = value;
  }

  get supportsCaretBrowsingMode(): boolean {
    return this._supportsCaretBrowsingMode.value!;
  }

  set supportsCaretBrowsingMode(value: boolean) {
    this._supportsCaretBrowsingMode.value = value;
  }

  get supportsDocumentFonts(): boolean {
    return this._supportsDocumentFonts.value!;
  }

  set supportsDocumentFonts(value: boolean) {
    this._supportsDocumentFonts.value = value;
  }

  get supportsIntegratedFind(): boolean {
    return this._supportsIntegratedFind.value!;
  }

  set supportsIntegratedFind(value: boolean) {
    this._supportsIntegratedFind.value = value;
  }

  get supportsMouseWheelZoomCtrlKey(): boolean {
    return this._supportsMouseWheelZoomCtrlKey.value!;
  }

  set supportsMouseWheelZoomCtrlKey(value: boolean) {
    this._supportsMouseWheelZoomCtrlKey.value = value;
  }

  get supportsMouseWheelZoomMetaKey(): boolean {
    return this._supportsMouseWheelZoomMetaKey.value!;
  }

  set supportsMouseWheelZoomMetaKey(value: boolean) {
    this._supportsMouseWheelZoomMetaKey.value = value;
  }

  get supportsPinchToZoom(): boolean {
    return this._supportsPinchToZoom.value!;
  }

  set supportsPinchToZoom(value: boolean) {
    this._supportsPinchToZoom.value = value;
  }

  get toolbarDensity(): number {
    return this._toolbarDensity.value!;
  }

  set toolbarDensity(value: number) {
    this._toolbarDensity.value = value;
  }

  get altTextLearnMoreUrl(): string {
    return this._altTextLearnMoreUrl.value!;
  }

  set altTextLearnMoreUrl(value: string) {
    this._altTextLearnMoreUrl.value = value;
  }

  get annotationEditorMode(): number {
    return this._annotationEditorMode.value!;
  }

  set annotationEditorMode(value: number) {
    this._annotationEditorMode.value = value;
  }

  get annotationMode(): AnnotationMode {
    return this._annotationMode.value!;
  }

  set annotationMode(value: AnnotationMode) {
    this._annotationMode.value = value;
  }

  get cursorToolOnLoad(): number {
    return this._cursorToolOnLoad.value!;
  }

  set cursorToolOnLoad(value: number) {
    this._cursorToolOnLoad.value = value;
  }

  get defaultZoomDelay(): number {
    return this._defaultZoomDelay.value!;
  }

  set defaultZoomDelay(value: number) {
    this._defaultZoomDelay.value = value;
  }

  get defaultZoomValue(): string {
    return this._defaultZoomValue.value!;
  }

  set defaultZoomValue(value: string) {
    this._defaultZoomValue.value = value;
  }

  get disableHistory(): boolean {
    return this._disableHistory.value!;
  }

  set disableHistory(value: boolean) {
    this._disableHistory.value = value;
  }

  get disablePageLabels(): boolean {
    return this._disablePageLabels.value!;
  }

  set disablePageLabels(value: boolean) {
    this._disablePageLabels.value = value;
  }

  get enableAltText(): boolean {
    return this._enableAltText.value!;
  }

  set enableAltText(value: boolean) {
    this._enableAltText.value = value;
  }

  get enableAltTextModelDownload(): boolean {
    return this._enableAltTextModelDownload.value!;
  }

  set enableAltTextModelDownload(value: boolean) {
    this._enableAltTextModelDownload.value = value;
  }

  get enableGuessAltText(): boolean {
    return this._enableGuessAltText.value!;
  }

  set enableGuessAltText(value: boolean) {
    this._enableGuessAltText.value = value;
  }

  get enableHighlightFloatingButton(): boolean {
    return this._enableHighlightFloatingButton.value!;
  }

  set enableHighlightFloatingButton(value: boolean) {
    this._enableHighlightFloatingButton.value = value;
  }

  get enableNewAltTextWhenAddingImage(): boolean {
    return this._enableNewAltTextWhenAddingImage.value!;
  }

  set enableNewAltTextWhenAddingImage(value: boolean) {
    this._enableNewAltTextWhenAddingImage.value = value;
  }

  get enablePermissions(): boolean {
    return this._enablePermissions.value!;
  }

  set enablePermissions(value: boolean) {
    this._enablePermissions.value = value;
  }

  get enablePrintAutoRotate(): boolean {
    return this._enablePrintAutoRotate.value!;
  }

  set enablePrintAutoRotate(value: boolean) {
    this._enablePrintAutoRotate.value = value;
  }

  get enableScripting(): boolean {
    return this._enableScripting.value!;
  }

  set enableScripting(value: boolean) {
    this._enableScripting.value = value;
  }

  get enableThumbnailView(): boolean {
    return this._enableThumbnailView.value!;
  }

  set enableThumbnailView(value: boolean) {
    this._enableThumbnailView.value = value;
  }

  get enableUpdatedAddImage(): boolean {
    return this._enableUpdatedAddImage.value!;
  }

  set enableUpdatedAddImage(value: boolean) {
    this._enableUpdatedAddImage.value = value;
  }

  get externalLinkRel(): string {
    return this._externalLinkRel.value!;
  }

  set externalLinkRel(value: string) {
    this._externalLinkRel.value = value;
  }

  get externalLinkTarget(): number {
    return this._externalLinkTarget.value!;
  }

  set externalLinkTarget(value: number) {
    this._externalLinkTarget.value = value;
  }

  get highlightEditorColors(): string {
    return this._highlightEditorColors.value!;
  }

  set highlightEditorColors(value: string) {
    this._highlightEditorColors.value = value;
  }

  get historyUpdateUrl(): boolean {
    return this._historyUpdateUrl.value!;
  }

  set historyUpdateUrl(value: boolean) {
    this._historyUpdateUrl.value = value;
  }

  get ignoreDestinationZoom(): boolean {
    return this._ignoreDestinationZoom.value!;
  }

  set ignoreDestinationZoom(value: boolean) {
    this._ignoreDestinationZoom.value = value;
  }

  get imageResourcesPath(): string {
    return this._imageResourcesPath.value!;
  }

  set imageResourcesPath(value: string) {
    this._imageResourcesPath.value = value;
  }

  get maxCanvasPixels(): number {
    return this._maxCanvasPixels.value!;
  }

  set maxCanvasPixels(value: number) {
    this._maxCanvasPixels.value = value;
  }

  get forcePageColors(): boolean {
    return this._forcePageColors.value!;
  }

  set forcePageColors(value: boolean) {
    this._forcePageColors.value = value;
  }

  get pageColorsBackground(): string {
    return this._pageColorsBackground.value!;
  }

  set pageColorsBackground(value: string) {
    this._pageColorsBackground.value = value;
  }

  get pageColorsForeground(): string {
    return this._pageColorsForeground.value!;
  }

  set pageColorsForeground(value: string) {
    this._pageColorsForeground.value = value;
  }

  get printResolution(): number {
    return this._printResolution.value!;
  }

  set printResolution(value: number) {
    this._printResolution.value = value;
  }

  get sidebarViewOnLoad(): number {
    return this._sidebarViewOnLoad.value!;
  }

  set sidebarViewOnLoad(value: number) {
    this._sidebarViewOnLoad.value = value;
  }

  get scrollModeOnLoad(): number {
    return this._scrollModeOnLoad.value!;
  }

  set scrollModeOnLoad(value: number) {
    this._scrollModeOnLoad.value = value;
  }

  get spreadModeOnLoad(): number {
    return this._spreadModeOnLoad.value!;
  }

  set spreadModeOnLoad(value: number) {
    this._spreadModeOnLoad.value = value;
  }

  get textLayerMode(): number {
    return this._textLayerMode.value!;
  }

  set textLayerMode(value: number) {
    this._textLayerMode.value = value;
  }

  get viewOnLoad(): number {
    return this._viewOnLoad.value!;
  }

  set viewOnLoad(value: number) {
    this._viewOnLoad.value = value;
  }

  get cMapPacked(): boolean {
    return this._cMapPacked.value!;
  }

  set cMapPacked(value: boolean) {
    this._cMapPacked.value = value;
  }

  get cMapUrl(): string {
    return this._cMapUrl.value!;
  }

  set cMapUrl(value: string) {
    this._cMapUrl.value = value;
  }

  get disableAutoFetch(): boolean {
    return this._disableAutoFetch.value!;
  }

  set disableAutoFetch(value: boolean) {
    this._disableAutoFetch.value = value;
  }

  get disableFontFace(): boolean {
    return this._disableFontFace.value!;
  }

  set disableFontFace(value: boolean) {
    this._disableFontFace.value = value;
  }

  get disableRange(): boolean {
    return this._disableRange.value!;
  }

  set disableRange(value: boolean) {
    this._disableRange.value = value;
  }

  get disableStream(): boolean {
    return this._disableStream.value!;
  }

  set disableStream(value: boolean) {
    this._disableStream.value = value;
  }

  get docBaseUrl(): string {
    return this._docBaseUrl.value!;
  }

  set docBaseUrl(value: string) {
    this._docBaseUrl.value = value;
  }

  get enableHWA(): boolean {
    return this._enableHWA.value!;
  }

  set enableHWA(value: boolean) {
    this._enableHWA.value = value;
  }

  get fontExtraProperties(): boolean {
    return this._fontExtraProperties.value!;
  }

  set fontExtraProperties(value: boolean) {
    this._fontExtraProperties.value = value;
  }

  get isEvalSupported(): boolean {
    return this._isEvalSupported.value!;
  }

  set isEvalSupported(value: boolean) {
    this._isEvalSupported.value = value;
  }

  get isOffscreenCanvasSupported(): boolean {
    return this._isOffscreenCanvasSupported.value!;
  }

  set isOffscreenCanvasSupported(value: boolean) {
    this._isOffscreenCanvasSupported.value = value;
  }

  get maxImageSize(): number {
    return this._maxImageSize.value!;
  }

  set maxImageSize(value: number) {
    this._maxImageSize.value = value;
  }

  get standardFontDataUrl(): string {
    return this._standardFontDataUrl.value!;
  }

  set standardFontDataUrl(value: string) {
    this._standardFontDataUrl.value = value;
  }

  get useSystemFonts(): boolean {
    return this._useSystemFonts.value!;
  }

  set useSystemFonts(value: boolean) {
    this._useSystemFonts.value = value;
  }

  get verbosity(): number {
    return this._verbosity.value!;
  }

  set verbosity(value: number) {
    this._verbosity.value = value;
  }

  get workPorter(): null {
    return this._workerPort.value!;
  }

  set workPorter(value: null) {
    this._workerPort.value = value;
  }

  get workerSrc(): string | null {
    return this._workerSrc.value;
  }

  set workerSrc(value: string | null) {
    this._workerSrc.value = value;
  }

  get viewerCssTheme(): ThemeMode {
    return this._viewerCssTheme.value!;
  }

  set viewerCssTheme(value: ThemeMode) {
    this._viewerCssTheme.value = value;
  }

  get enableFakeMLManager(): boolean {
    return this._enableFakeMLManager.value!;
  }

  set enableFakeMLManager(value: boolean) {
    this._enableFakeMLManager.value = value;
  }


  get disablePreferences(): boolean {
    return this._disablePreferences.value!;
  }


  set disablePreferences(value: boolean) {
    this._disablePreferences.value = value;
  }

}
