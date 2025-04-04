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
import {
  BaseException,
  FeatureTest,
  PlatformHelper,
  RectType,
  shadow,
  TransformType,
  Util,
  warn,
} from "seren-common";

export const SVG_NS = "http://www.w3.org/2000/svg";

export interface AvailableSpace {
  width: number,
  height: number
}

export class PixelsPerInch {

  static CSS = 96.0;

  static PDF = 72.0;

  static PDF_TO_CSS_UNITS = this.CSS / this.PDF;
}

export async function fetchData(
  url: string | URL,
  type: XMLHttpRequestResponseType = "text"
) {
  if (PlatformHelper.isMozCental() || isValidFetchUrl(url, document.baseURI)) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    switch (type) {
      case "arraybuffer":
        return response.arrayBuffer();
      case "blob":
        return response.blob();
      case "json":
        return response.json();
    }
    return response.text();
  }

  // The Fetch API is not supported.
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("GET", url, /* async = */ true);
    request.responseType = type;

    request.onreadystatechange = () => {
      if (request.readyState !== XMLHttpRequest.DONE) {
        return;
      }
      if (request.status === 200 || request.status === 0) {
        switch (type) {
          case "arraybuffer":
          case "blob":
          case "json":
            resolve(request.response);
            return;
        }
        resolve(request.responseText);
        return;
      }
      reject(new Error(request.statusText));
    };

    request.send(null);
  });
}

export interface PageViewportParameters {

  /** The xMin, yMin, xMax and yMax coordinates. */
  viewBox: RectType;

  /** The scale of the viewport. */
  scale: number;

  /** The rotation, in degrees, of the viewport. */
  rotation: number;

  /** The horizontal, i.e. x-axis, offset. The default value is `0`. */
  offsetX: number;

  /** The vertical, i.e. y-axis, offset. The default value is `0`. */
  offsetY: number;

  /** If true, the y-axis will not be flipped.The default value is `false`. */
  dontFlip: boolean;
}

export interface PageViewportCloneParameters {

  /**
   * The scale, overriding the one in the cloned viewport.
   * @default this.scale
   */
  scale: number;

  /** 
   * The rotation, in degrees, overriding the one in the cloned viewport.
   * @default this.rotation
   * */
  rotation: number;

  /**
   * The horizontal, i.e. x-axis, offset. 
   * @default this.offsetX
   */
  offsetX: number;

  /** 
   * The vertical, i.e. y-axis, offset.
   * @default this.offsetY
   * */
  offsetY: number;

  /**
   * If true, the x-axis will not be flipped.
   * @default false
   */
  dontFlip: boolean;
}

/**
 * PDF page viewport created based on scale, rotation and offset.
 */
export class PageViewport {

  protected viewBox: RectType;

  public scale: number;

  public rotation: number;

  protected offsetX: number;

  protected offsetY: number;

  public transform: TransformType;

  public width: number;

  public height: number;

  constructor(
    viewBox: RectType,
    scale: number,
    rotation: number,
    offsetX = 0,
    offsetY = 0,
    dontFlip = false,
  ) {
    this.viewBox = viewBox;
    this.scale = scale;
    this.rotation = rotation;
    this.offsetX = offsetX;
    this.offsetY = offsetY;

    // creating transform to convert pdf coordinate system to the normal
    // canvas like coordinates taking in account scale and rotation
    const centerX = (viewBox[2] + viewBox[0]) / 2;
    const centerY = (viewBox[3] + viewBox[1]) / 2;
    let rotateA, rotateB, rotateC, rotateD;
    // Normalize the rotation, by clamping it to the [0, 360) range.
    rotation %= 360;
    if (rotation < 0) {
      rotation += 360;
    }
    switch (rotation) {
      case 180:
        rotateA = -1;
        rotateB = 0;
        rotateC = 0;
        rotateD = 1;
        break;
      case 90:
        rotateA = 0;
        rotateB = 1;
        rotateC = 1;
        rotateD = 0;
        break;
      case 270:
        rotateA = 0;
        rotateB = -1;
        rotateC = -1;
        rotateD = 0;
        break;
      case 0:
        rotateA = 1;
        rotateB = 0;
        rotateC = 0;
        rotateD = -1;
        break;
      default:
        throw new Error(
          "PageViewport: Invalid rotation, must be a multiple of 90 degrees."
        );
    }

    if (dontFlip) {
      rotateC = -rotateC;
      rotateD = -rotateD;
    }

    let offsetCanvasX, offsetCanvasY;
    let width, height;
    if (rotateA === 0) {
      offsetCanvasX = Math.abs(centerY - viewBox[1]) * scale + offsetX;
      offsetCanvasY = Math.abs(centerX - viewBox[0]) * scale + offsetY;
      width = (viewBox[3] - viewBox[1]) * scale;
      height = (viewBox[2] - viewBox[0]) * scale;
    } else {
      offsetCanvasX = Math.abs(centerX - viewBox[0]) * scale + offsetX;
      offsetCanvasY = Math.abs(centerY - viewBox[1]) * scale + offsetY;
      width = (viewBox[2] - viewBox[0]) * scale;
      height = (viewBox[3] - viewBox[1]) * scale;
    }
    // creating transform for the following operations:
    // translate(-centerX, -centerY), rotate and flip vertically,
    // scale, and translate(offsetCanvasX, offsetCanvasY)
    this.transform = [
      rotateA * scale,
      rotateB * scale,
      rotateC * scale,
      rotateD * scale,
      offsetCanvasX - rotateA * scale * centerX - rotateC * scale * centerY,
      offsetCanvasY - rotateB * scale * centerX - rotateD * scale * centerY,
    ];

    this.width = width;
    this.height = height;
  }

  /**
   * The original, un-scaled, viewport dimensions.
   * @type {Object}
   */
  get rawDims() {
    const { viewBox } = this;
    return shadow(this, "rawDims", {
      pageWidth: viewBox[2] - viewBox[0],
      pageHeight: viewBox[3] - viewBox[1],
      pageX: viewBox[0],
      pageY: viewBox[1],
    });
  }

  /**
   * Clones viewport, with optional additional properties.
   * @param {PageViewportCloneParameters} [params]
   * @returns {PageViewport} Cloned viewport.
   */
  clone(
    scale: number | null = null,
    rotation: number | null = null,
    offsetX: number | null = null,
    offsetY: number | null = null,
    dontFlip = false,
  ): PageViewport {
    scale ||= this.scale;
    rotation ||= this.rotation;
    offsetX ||= this.offsetX;
    offsetY ||= this.offsetY;
    return new PageViewport(
      <RectType>this.viewBox.slice(), scale, rotation, offsetX, offsetY, dontFlip,
    );
  }

  /**
   * Converts PDF point to the viewport coordinates. For examples, useful for
   * converting PDF location into canvas pixel coordinates.
   * @param {number} x - The x-coordinate.
   * @param {number} y - The y-coordinate.
   * @returns {Array} Array containing `x`- and `y`-coordinates of the
   *   point in the viewport coordinate space.
   * @see {@link convertToPdfPoint}
   * @see {@link convertToViewportRectangle}
   */
  convertToViewportPoint(x: number, y: number): [number, number] {
    return Util.applyTransform([x, y], this.transform);
  }

  /**
   * Converts PDF rectangle to the viewport coordinates.
   * @param {Array} rect - The xMin, yMin, xMax and yMax coordinates.
   * @returns {Array} Array containing corresponding coordinates of the
   *   rectangle in the viewport coordinate space.
   * @see {@link convertToViewportPoint}
   */
  convertToViewportRectangle(rect: RectType): RectType {
    const topLeft = Util.applyTransform([rect[0], rect[1]], this.transform);
    const bottomRight = Util.applyTransform([rect[2], rect[3]], this.transform);
    return [topLeft[0], topLeft[1], bottomRight[0], bottomRight[1]];
  }

  /**
   * Converts viewport coordinates to the PDF location. For examples, useful
   * for converting canvas pixel location into PDF one.
   * @param {number} x - The x-coordinate.
   * @param {number} y - The y-coordinate.
   * @returns {Array} Array containing `x`- and `y`-coordinates of the
   *   point in the PDF coordinate space.
   * @see {@link convertToViewportPoint}
   */
  convertToPdfPoint(x: number, y: number) {
    return Util.applyInverseTransform([x, y], this.transform);
  }
}

export class RenderingCancelledException extends BaseException {
  extraDelay: number;
  constructor(msg: string, extraDelay = 0) {
    super(msg, "RenderingCancelledException");
    this.extraDelay = extraDelay;
  }
}

export function isDataScheme(url: string) {
  const ii = url.length;
  let i = 0;
  while (i < ii && url[i].trim() === "") {
    i++;
  }
  return url.substring(i, i + 5).toLowerCase() === "data:";
}

export function isPdfFile(filename: string | null) {
  return typeof filename === "string" && /\.pdf$/i.test(filename);
}

/**
 * Gets the filename from a given URL.
 * @param {string} url
 * @returns {string}
 */
export function getFilenameFromUrl(url: string): string {
  [url] = url.split(/[#?]/, 1);
  return url.substring(url.lastIndexOf("/") + 1);
}

/**
 * Returns the filename or guessed filename from the url (see issue 3455).
 * @param url - The original PDF location.
 * @param defaultFilename - The value returned if the filename is
 *   unknown, or the protocol is unsupported.
 * @returns Guessed PDF filename.
 */
export function getPdfFilenameFromUrl(url: string, defaultFilename = "document.pdf"): string {
  if (typeof url !== "string") {
    return defaultFilename;
  }
  if (isDataScheme(url)) {
    warn('getPdfFilenameFromUrl: ignore "data:"-URL for performance reasons.');
    return defaultFilename;
  }
  const reURI = /^(?:(?:[^:]+:)?\/\/[^/]+)?([^?#]*)(\?[^#]*)?(#.*)?$/;
  //              SCHEME        HOST        1.PATH  2.QUERY   3.REF
  // Pattern to get last matching NAME.pdf
  const reFilename = /[^/?#=]+\.pdf\b(?!.*\.pdf\b)/i;
  const splitURI = reURI.exec(url)!;
  let suggestedFilename: RegExpExecArray | string | null =
    reFilename.exec(splitURI[1]) ||
    reFilename.exec(splitURI[2]) ||
    reFilename.exec(splitURI[3]);
  if (suggestedFilename) {
    suggestedFilename = suggestedFilename[0];
    if (suggestedFilename.includes("%")) {
      // URL-encoded %2Fpath%2Fto%2Ffile.pdf should be file.pdf
      try {
        suggestedFilename = reFilename.exec(
          decodeURIComponent(<string>suggestedFilename)
        )![0];
      } catch {
        // Possible (extremely rare) errors:
        // URIError "Malformed URI", e.g. for "%AA.pdf"
        // TypeError "null has no properties", e.g. for "%2F.pdf"
      }
    }
  }
  return suggestedFilename || defaultFilename;
}

interface TimeStat {
  name: string;
  start: number;
  end: number;
}

export class StatTimer {

  started: Record<string, any> = Object.create(null);

  times: TimeStat[] = [];

  time(name: string) {
    if (name in this.started) {
      warn(`Timer is already running for ${name}`);
    }
    this.started[name] = Date.now();
  }

  timeEnd(name: string) {
    if (!(name in this.started)) {
      warn(`Timer has not been started for ${name}`);
    }
    this.times.push({
      name,
      start: this.started[name],
      end: Date.now(),
    });
    // Remove timer from started so it can be called again.
    delete this.started[name];
  }

  toString() {
    // Find the longest name for padding purposes.
    const outBuf = [];
    let longest = 0;
    for (const { name } of this.times) {
      longest = Math.max(name.length, longest);
    }
    for (const { name, start, end } of this.times) {
      outBuf.push(`${name.padEnd(longest)} ${end - start}ms\n`);
    }
    return outBuf.join("");
  }
}

export function isValidFetchUrl(url: string | URL, baseUrl?: string) {
  if (PlatformHelper.isMozCental()) {
    throw new Error("Not implemented: isValidFetchUrl");
  }

  try {
    const { protocol } = baseUrl ? new URL(url, baseUrl) : new URL(url);
    // The Fetch API only supports the http/https protocols, and not file/ftp.
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false; // `new URL()` will throw on incorrect data.
  }
}

/**
 * Event handler to suppress context menu.
 */
export function noContextMenu(e: Event) {
  e.preventDefault();
}

// Deprecated API function -- display regardless of the `verbosity` setting.
export function deprecated(details?: string) {
  console.log("Deprecated API usage: " + details);
}

export class PDFDateString {

  static #regex?: RegExp;

  /**
   * Convert a PDF date string to a JavaScript `Date` object.
   *
   * The PDF date string format is described in section 7.9.4 of the official
   * PDF 32000-1:2008 specification. However, in the PDF 1.7 reference (sixth
   * edition) Adobe describes the same format including a trailing apostrophe.
   * This syntax in incorrect, but Adobe Acrobat creates PDF files that contain
   * them. We ignore all apostrophes as they are not necessary for date parsing.
   *
   * Moreover, Adobe Acrobat doesn't handle changing the date to universal time
   * and doesn't use the user's time zone (effectively ignoring the HH' and mm'
   * parts of the date string).
   *
   * @param {string} input
   * @returns {Date|null}
   */
  static toDateObject(input: string | null): Date | null {
    if (!input || typeof input !== "string") {
      return null;
    }

    // Lazily initialize the regular expression.
    this.#regex ||= new RegExp(
      "^D:" + // Prefix (required)
      "(\\d{4})" + // Year (required)
      "(\\d{2})?" + // Month (optional)
      "(\\d{2})?" + // Day (optional)
      "(\\d{2})?" + // Hour (optional)
      "(\\d{2})?" + // Minute (optional)
      "(\\d{2})?" + // Second (optional)
      "([Z|+|-])?" + // Universal time relation (optional)
      "(\\d{2})?" + // Offset hour (optional)
      "'?" + // Splitting apostrophe (optional)
      "(\\d{2})?" + // Offset minute (optional)
      "'?" // Trailing apostrophe (optional)
    );

    // Optional fields that don't satisfy the requirements from the regular
    // expression (such as incorrect digit counts or numbers that are out of
    // range) will fall back the defaults from the specification.
    const matches = this.#regex.exec(input);
    if (!matches) {
      return null;
    }

    // JavaScript's `Date` object expects the month to be between 0 and 11
    // instead of 1 and 12, so we have to correct for that.
    const year = parseInt(matches[1], 10);
    let month = parseInt(matches[2], 10);
    month = month >= 1 && month <= 12 ? month - 1 : 0;
    let day = parseInt(matches[3], 10);
    day = day >= 1 && day <= 31 ? day : 1;
    let hour = parseInt(matches[4], 10);
    hour = hour >= 0 && hour <= 23 ? hour : 0;
    let minute = parseInt(matches[5], 10);
    minute = minute >= 0 && minute <= 59 ? minute : 0;
    let second = parseInt(matches[6], 10);
    second = second >= 0 && second <= 59 ? second : 0;
    const universalTimeRelation = matches[7] || "Z";
    let offsetHour = parseInt(matches[8], 10);
    offsetHour = offsetHour >= 0 && offsetHour <= 23 ? offsetHour : 0;
    let offsetMinute = parseInt(matches[9], 10) || 0;
    offsetMinute = offsetMinute >= 0 && offsetMinute <= 59 ? offsetMinute : 0;

    // Universal time relation 'Z' means that the local time is equal to the
    // universal time, whereas the relations '+'/'-' indicate that the local
    // time is later respectively earlier than the universal time. Every date
    // is normalized to universal time.
    if (universalTimeRelation === "-") {
      hour += offsetHour;
      minute += offsetMinute;
    } else if (universalTimeRelation === "+") {
      hour -= offsetHour;
      minute -= offsetMinute;
    }

    return new Date(Date.UTC(year, month, day, hour, minute, second));
  }
}

export function getRGB(color: string): number[] {
  if (color.startsWith("#")) {
    const colorRGB = parseInt(color.slice(1), 16);
    return [
      (colorRGB & 0xff0000) >> 16,
      (colorRGB & 0x00ff00) >> 8,
      colorRGB & 0x0000ff,
    ];
  }

  if (color.startsWith("rgb(")) {
    // getComputedStyle(...).color returns a `rgb(R, G, B)` color.
    return color
      .slice(/* "rgb(".length */ 4, -1) // Strip out "rgb(" and ")".
      .split(",")
      .map(x => parseInt(x));
  }

  if (color.startsWith("rgba(")) {
    return color
      .slice(/* "rgba(".length */ 5, -1) // Strip out "rgba(" and ")".
      .split(",")
      .map(x => parseInt(x))
      .slice(0, 3);
  }

  warn(`Not a valid color format: "${color}"`);
  return [0, 0, 0];
}

export function getColorValues(colors: Map<string, number[] | null>) {
  const span = document.createElement("span");
  span.style.visibility = "hidden";
  document.body.append(span);
  for (const name of colors.keys()) {
    span.style.color = name;
    const computedColor = window.getComputedStyle(span).color;
    colors.set(name, getRGB(computedColor));
  }
  span.remove();
}

export function getCurrentTransform(ctx: CanvasRenderingContext2D): TransformType {
  const { a, b, c, d, e, f } = ctx.getTransform();
  return [a, b, c, d, e, f];
}

export function getCurrentTransformInverse(ctx: CanvasRenderingContext2D): TransformType {
  const { a, b, c, d, e, f } = ctx.getTransform().invertSelf();
  return [a, b, c, d, e, f];
}

export function setLayerDimensions(
  div: HTMLDivElement,
  viewport: PageViewport | { rotation: number },
  mustFlip = false,
  mustRotate = true
) {
  if (viewport instanceof PageViewport) {
    const { pageWidth, pageHeight } = viewport.rawDims;
    const { style } = div;
    const useRound = FeatureTest.isCSSRoundSupported;

    const w = `var(--scale-factor) * ${pageWidth}px`, h = `var(--scale-factor) * ${pageHeight}px`;

    const widthStr = useRound ? `round(down, ${w}, var(--scale-round-x, 1px))` : `calc(${w})`,
      heightStr = useRound ? `round(down, ${h}, var(--scale-round-y, 1px))` : `calc(${h})`;

    if (!mustFlip || viewport.rotation % 180 === 0) {
      style.width = widthStr;
      style.height = heightStr;
    } else {
      style.width = heightStr;
      style.height = widthStr;
    }
  }

  if (mustRotate) {
    div.setAttribute("data-main-rotation", viewport.rotation.toString());
  }
}

/**
 * Scale factors for the canvas, necessary with HiDPI displays.
 */
export class OutputScale {

  public sx: number;

  public sy: number;

  constructor() {
    const pixelRatio = window.devicePixelRatio || 1;

    /**
     * @type {number} Horizontal scale.
     */
    this.sx = pixelRatio;

    /**
     * @type {number} Vertical scale.
     */
    this.sy = pixelRatio;
  }

  /**
   * @type {boolean} Returns `true` when scaling is required, `false` otherwise.
   */
  get scaled() {
    return this.sx !== 1 || this.sy !== 1;
  }

  get symmetric() {
    return this.sx === this.sy;
  }
}
