/**
 * This is the main entry point for loading a PDF and interacting with it.
 *
 * NOTE: If a URL is used to fetch the PDF data a standard Fetch API call (or
 * XHR as fallback) is used, which means it must follow same origin rules,
 * e.g. no cross-domain requests without CORS.
 *
 * @param {string | URL | TypedArray | ArrayBuffer | DocumentInitParameters}
 *   src - Can be a URL where a PDF file is located, a typed array (Uint8Array)
 *         already populated with data, or a parameter object.
 * @returns {PDFDocumentLoadingTask}
 */
export class DocumentEvaluatorOptions {

  readonly maxImageSize: number;

  readonly disableFontFace: boolean;

  readonly ignoreErrors: boolean;

  readonly isEvalSupported: boolean;

  public isOffscreenCanvasSupported: boolean;

  readonly isChrome: boolean;

  readonly canvasMaxAreaInBytes: number;

  readonly fontExtraProperties: boolean;

  readonly useSystemFonts: boolean;

  readonly cMapUrl: string | null;

  readonly standardFontDataUrl: string | null;

  constructor(
    maxImageSize: number,
    disableFontFace: boolean,
    ignoreErrors: boolean,
    isEvalSupported: boolean,
    isOffscreenCanvasSupported: boolean,
    isChrome: boolean,
    canvasMaxAreaInBytes: number,
    fontExtraProperties: boolean,
    useSystemFonts: boolean,
    cMapUrl: string | null,
    standardFontDataUrl: string | null,
  ) {
    this.maxImageSize = maxImageSize;
    this.disableFontFace = disableFontFace;
    this.ignoreErrors = ignoreErrors;
    this.isEvalSupported = isEvalSupported;
    this.isOffscreenCanvasSupported = isOffscreenCanvasSupported;
    this.isChrome = isChrome;
    this.canvasMaxAreaInBytes = canvasMaxAreaInBytes;
    this.fontExtraProperties = fontExtraProperties;
    this.useSystemFonts = useSystemFonts;
    this.cMapUrl = cMapUrl;
    this.standardFontDataUrl = standardFontDataUrl;
  }
}