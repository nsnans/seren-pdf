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

import { CFF, CFFCompiler, CFFParser } from "./cff_parser";
import { SEAC_ANALYSIS_ENABLED, type1FontGlyphMapping } from "./fonts_utils";
import { warn } from "seren-common";
import { EvaluatorProperties } from "../../parser/evaluator/evaluator";
import { Stream } from "../../stream/stream";

class CFFFont {

  public cff: CFF;

  protected properties: EvaluatorProperties;

  // 解析成功的时候是any[]，失败的时候是Stream
  public data: any[] | Stream;

  public seacs: number[][];

  constructor(file: Stream, properties: EvaluatorProperties) {
    this.properties = properties;

    const parser = new CFFParser(file, properties, SEAC_ANALYSIS_ENABLED);
    this.cff = parser.parse();
    this.cff.duplicateFirstGlyph();
    const compiler = new CFFCompiler(this.cff);
    this.seacs = this.cff.seacs;
    try {
      this.data = compiler.compile();
    } catch {
      warn("Failed to compile font " + properties.loadedName);
      // There may have just been an issue with the compiler, set the data
      // anyway and hope the font loaded.
      this.data = file;
    }
    this._createBuiltInEncoding();
  }

  get numGlyphs() {
    return this.cff.charStrings!.count;
  }

  getCharset() {
    return this.cff.charset!.charset;
  }

  getGlyphMapping(): Record<number, number> {
    const cff = this.cff;
    const properties = this.properties;
    const { cidToGidMap, cMap } = properties;
    const charsets = cff.charset!.charset;
    let charCodeToGlyphId;
    let glyphId;

    if (properties.composite) {
      let invCidToGidMap;
      if (cidToGidMap?.length > 0) {
        invCidToGidMap = Object.create(null);
        for (let i = 0, ii = cidToGidMap.length; i < ii; i++) {
          const gid = cidToGidMap[i];
          if (gid !== undefined) {
            invCidToGidMap[gid] = i;
          }
        }
      }

      charCodeToGlyphId = Object.create(null);
      let charCode;
      if (cff.isCIDFont) {
        // If the font is actually a CID font then we should use the charset
        // to map CIDs to GIDs.
        for (glyphId = 0; glyphId < charsets.length; glyphId++) {
          const cid = charsets[glyphId];
          charCode = cMap!.charCodeOf(<number>cid);

          if (invCidToGidMap?.[charCode] !== undefined) {
            // According to the PDF specification, see Table 117, it's not clear
            // that a /CIDToGIDMap should be used with any non-TrueType fonts,
            // however it's necessary to do so in order to fix issue 15559.
            //
            // It seems, in the CFF-case, that the /CIDToGIDMap needs to be used
            // "inverted" compared to the TrueType-case. Here it thus seem to be
            // a charCode mapping, rather than the normal CID to GID mapping.
            charCode = invCidToGidMap[charCode];
          }
          charCodeToGlyphId[charCode] = glyphId;
        }
      } else {
        // If it is NOT actually a CID font then CIDs should be mapped
        // directly to GIDs.
        for (glyphId = 0; glyphId < cff.charStrings!.count; glyphId++) {
          charCode = cMap!.charCodeOf(glyphId);
          charCodeToGlyphId[charCode] = glyphId;
        }
      }
      return charCodeToGlyphId;
    }

    let encoding: (number | string)[] | null = cff.encoding ? cff.encoding.encoding : null;
    if (properties.isInternalFont) {
      encoding = properties.defaultEncoding;
    }
    charCodeToGlyphId = type1FontGlyphMapping(properties, encoding!, charsets);
    return charCodeToGlyphId;
  }

  hasGlyphId(id: number) {
    return this.cff.hasGlyphId(id);
  }

  /**
   * @private
   */
  _createBuiltInEncoding() {
    const { charset, encoding } = this.cff;
    if (!charset || !encoding) {
      return;
    }
    const charsets = charset.charset;
    const encodings = encoding.encoding;
    const map: (string | number)[] = [];

    for (const charCode in encodings) {
      const glyphId = encodings[charCode];
      if (glyphId >= 0) {
        const glyphName = charsets[glyphId];
        if (glyphName) {
          map[Number(charCode)] = glyphName;
        }
      }
    }
    if (map.length > 0) {
      this.properties.builtInEncoding = map;
    }
  }
}

export { CFFFont };
