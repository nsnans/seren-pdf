
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