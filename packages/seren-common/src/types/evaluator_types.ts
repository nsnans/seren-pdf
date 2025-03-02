import { TransformType } from "../common/common_types";

export interface EvaluatorTextContent {
  items: (TextItem | TextMarkedContent)[];
  styles: Map<string, TextStyle>;
  lang: string | null;
}
/**
 * Page text marked content part.
 */

export interface TextMarkedContent {

  /** Either 'beginMarkedContent', 'beginMarkedContentProps', or 'endMarkedContent'. */
  type: string;

  /** The marked content identifier. Only used for type 'beginMarkedContentProps'. */
  id: string | null;

  tag: string | null;
}


/**
 * Text style.
 */
export interface TextStyle {

  /** Font ascent.*/
  ascent: number;

  /** Font descent.*/
  descent: number;

  /** Whether or not the text is in vertical mode.*/
  vertical: boolean;

  /** The possible font family.*/
  fontFamily: string;

  fontSubstitution: string | null;

  fontSubstitutionLoadedName: string | null;
}

/**
 * Page text content.
 */
export interface TextContent {
  /**
   * Array of {@link TextItem} and {@link TextMarkedContent} objects.
   * TextMarkedContent items are included when includeMarkedContent is true.
   */
  items: Array<TextItem | TextMarkedContent>;

  /** {@link TextStyle} objects, indexed by font name. */
  styles: Map<string, TextStyle>;

  /** The document /Lang attribute. */
  lang: string | null;
}

/**
 * Page text content part.
 */
export interface TextItem {

  /** Text content.*/
  str: string;

  /** Text direction: 'ttb', 'ltr' or 'rtl'.*/
  dir: string;

  /** Transformation matrix.*/
  transform: TransformType | null;

  /** Width in device space.*/
  width: number;

  /** Height in device space.*/
  height: number;

  /** Font name used by PDF.js for converted font. */
  fontName: string;

  /** Indicating if the text content is followed by aline-break.*/
  hasEOL: boolean;
}

export interface SeacMapValue {
  baseFontCharCode: number;
  accentFontCharCode: number;
  accentOffset: {
    x: number;
    y: number;
  };
}

