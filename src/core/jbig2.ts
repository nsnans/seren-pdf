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

import { BaseException, shadow } from "../shared/util";
import { log2, readInt8, readUint16, readUint32 } from "./core_utils";
import { ArithmeticDecoder } from "./arithmetic_decoder";
import { CCITTFaxDecoder } from "./ccitt";
import { PlatformHelper } from "../platform/platform_helper";
import { Uint8TypedArray } from "../common/typed_array";

export class Jbig2Error extends BaseException {
  constructor(msg: string) {
    super(msg, "Jbig2Error");
  }
}

// Utility data structures
// 这个类比较简单，做了一些改写，把this[id]的写法干掉了
class ContextCache {

  protected map = new Map<string, Int8Array>;

  getContexts(id: string) {
    if (!this.map.has(id)) {
      this.map.set(id, new Int8Array(1 << 16));
    }
    return this.map.get(id)!
  }
}

class DecodingContext {

  public start: number;

  public end: number;

  public data: Uint8TypedArray;

  constructor(data: Uint8TypedArray, start: number, end: number) {
    this.data = data;
    this.start = start;
    this.end = end;
  }

  get decoder() {
    const decoder = new ArithmeticDecoder(this.data, this.start, this.end);
    return shadow(this, "decoder", decoder);
  }

  get contextCache() {
    const cache = new ContextCache();
    return shadow(this, "contextCache", cache);
  }
}

const MAX_INT_32 = 2 ** 31 - 1;
const MIN_INT_32 = -(2 ** 31);

// Annex A. Arithmetic Integer Decoding Procedure
// A.2 Procedure for decoding values
function decodeInteger(contextCache: ContextCache, procedure: string, decoder: ArithmeticDecoder) {
  const contexts = contextCache.getContexts(procedure);
  let prev = 1;

  function readBits(length: number) {
    let v = 0;
    for (let i = 0; i < length; i++) {
      const bit = decoder.readBit(contexts, prev);
      prev = prev < 256 ? (prev << 1) | bit : (((prev << 1) | bit) & 511) | 256;
      v = (v << 1) | bit;
    }
    return v >>> 0;
  }

  const sign = readBits(1);
  // prettier-ignore
  /* eslint-disable no-nested-ternary */
  const value = readBits(1) ?
    (readBits(1) ?
      (readBits(1) ?
        (readBits(1) ?
          (readBits(1) ?
            (readBits(32) + 4436) :
            readBits(12) + 340) :
          readBits(8) + 84) :
        readBits(6) + 20) :
      readBits(4) + 4) :
    readBits(2);
  /* eslint-enable no-nested-ternary */
  let signedValue;
  if (sign === 0) {
    signedValue = value;
  } else if (value > 0) {
    signedValue = -value;
  } else {
    throw new Error("signed value不应当为负数,如果出现负数,则说明存在问题")
  }
  // Ensure that the integer value doesn't underflow or overflow.
  if (signedValue >= MIN_INT_32 && signedValue <= MAX_INT_32) {
    return signedValue;
  }
  return null;
}

// A.3 The IAID decoding procedure
function decodeIAID(contextCache: ContextCache, decoder: ArithmeticDecoder, codeLength: number) {
  const contexts = contextCache.getContexts("IAID");

  let prev = 1;
  for (let i = 0; i < codeLength; i++) {
    const bit = decoder.readBit(contexts, prev);
    prev = (prev << 1) | bit;
  }
  if (codeLength < 31) {
    return prev & ((1 << codeLength) - 1);
  }
  return prev & 0x7fffffff;
}

enum SegmentType {
  SymbolDictionary = "SymbolDictionary",
  IntermediateTextRegion = "IntermediateTextRegion",
  ImmediateTextRegion = "ImmediateTextRegion",
  ImmediateLosslessTextRegion = "ImmediateLosslessTextRegion",
  PatternDictionary = "PatternDictionary",
  IntermediateHalftoneRegion = "IntermediateHalftoneRegion",
  ImmediateHalftoneRegion = "ImmediateHalftoneRegion",
  ImmediateLosslessHalftoneRegion = "ImmediateLosslessHalftoneRegion",
  IntermediateGenericRegion = "IntermediateGenericRegion",
  ImmediateGenericRegion = "ImmediateGenericRegion",
  ImmediateLosslessGenericRegion = "ImmediateLosslessGenericRegion",
  IntermediateGenericRefinementRegion = "IntermediateGenericRefinementRegion",
  ImmediateGenericRefinementRegion = "ImmediateGenericRefinementRegion",
  ImmediateLosslessGenericRefinementRegion = "ImmediateLosslessGenericRefinementRegion",
  PageInformation = "PageInformation",
  EndOfPage = "EndOfPage",
  EndOfStripe = "EndOfStripe",
  EndOfFile = "EndOfFile",
  Profiles = "Profiles",
  Tables = "Tables",
  Extension = "Extension"
}

// 7.3 Segment types
const SegmentTypes: (SegmentType | null)[] = [
  SegmentType.SymbolDictionary,
  null,
  null,
  null,
  SegmentType.IntermediateTextRegion,
  null,
  SegmentType.ImmediateTextRegion,
  SegmentType.ImmediateLosslessTextRegion,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  SegmentType.PatternDictionary,
  null,
  null,
  null,
  SegmentType.IntermediateHalftoneRegion,
  null,
  SegmentType.ImmediateHalftoneRegion,
  SegmentType.ImmediateLosslessHalftoneRegion,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  SegmentType.IntermediateGenericRegion,
  null,
  SegmentType.ImmediateGenericRegion,
  SegmentType.ImmediateLosslessGenericRegion,
  SegmentType.IntermediateGenericRefinementRegion,
  null,
  SegmentType.ImmediateGenericRefinementRegion,
  SegmentType.ImmediateLosslessGenericRefinementRegion,
  null,
  null,
  null,
  null,
  SegmentType.PageInformation,
  SegmentType.EndOfPage,
  SegmentType.EndOfStripe,
  SegmentType.EndOfFile,
  SegmentType.Profiles,
  SegmentType.Tables,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  SegmentType.Extension,
];

const CodingTemplates = [
  [
    { x: -1, y: -2 },
    { x: 0, y: -2 },
    { x: 1, y: -2 },
    { x: -2, y: -1 },
    { x: -1, y: -1 },
    { x: 0, y: -1 },
    { x: 1, y: -1 },
    { x: 2, y: -1 },
    { x: -4, y: 0 },
    { x: -3, y: 0 },
    { x: -2, y: 0 },
    { x: -1, y: 0 },
  ],
  [
    { x: -1, y: -2 },
    { x: 0, y: -2 },
    { x: 1, y: -2 },
    { x: 2, y: -2 },
    { x: -2, y: -1 },
    { x: -1, y: -1 },
    { x: 0, y: -1 },
    { x: 1, y: -1 },
    { x: 2, y: -1 },
    { x: -3, y: 0 },
    { x: -2, y: 0 },
    { x: -1, y: 0 },
  ],
  [
    { x: -1, y: -2 },
    { x: 0, y: -2 },
    { x: 1, y: -2 },
    { x: -2, y: -1 },
    { x: -1, y: -1 },
    { x: 0, y: -1 },
    { x: 1, y: -1 },
    { x: -2, y: 0 },
    { x: -1, y: 0 },
  ],
  [
    { x: -3, y: -1 },
    { x: -2, y: -1 },
    { x: -1, y: -1 },
    { x: 0, y: -1 },
    { x: 1, y: -1 },
    { x: -4, y: 0 },
    { x: -3, y: 0 },
    { x: -2, y: 0 },
    { x: -1, y: 0 },
  ],
];

const RefinementTemplates = [
  {
    coding: [
      { x: 0, y: -1 },
      { x: 1, y: -1 },
      { x: -1, y: 0 },
    ],
    reference: [
      { x: 0, y: -1 },
      { x: 1, y: -1 },
      { x: -1, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: -1, y: 1 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ],
  },
  {
    coding: [
      { x: -1, y: -1 },
      { x: 0, y: -1 },
      { x: 1, y: -1 },
      { x: -1, y: 0 },
    ],
    reference: [
      { x: 0, y: -1 },
      { x: -1, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ],
  },
];

// See 6.2.5.7 Decoding the bitmap.
const ReusedContexts = [
  0x9b25, // 10011 0110010 0101
  0x0795, // 0011 110010 101
  0x00e5, // 001 11001 01
  0x0195, // 011001 0101
];

const RefinementReusedContexts = [
  0x0020, // '000' + '0' (coding) + '00010000' + '0' (reference)
  0x0008, // '0000' + '001000'
];

function decodeBitmapTemplate0(width: number, height: number, decodingContext: DecodingContext) {
  const decoder = decodingContext.decoder;
  const contexts = decodingContext.contextCache.getContexts("GB");
  const bitmap = [];
  let contextLabel, i, j, pixel, row, row1, row2;

  // ...ooooo....
  // ..ooooooo... Context template for current pixel (X)
  // .ooooX...... (concatenate values of 'o'-pixels to get contextLabel)
  const OLD_PIXEL_MASK = 0x7bf7; // 01111 0111111 0111

  for (i = 0; i < height; i++) {
    row = bitmap[i] = new Uint8Array(width);
    row1 = i < 1 ? row : bitmap[i - 1];
    row2 = i < 2 ? row : bitmap[i - 2];

    // At the beginning of each row:
    // Fill contextLabel with pixels that are above/right of (X)
    contextLabel =
      (row2[0] << 13) |
      (row2[1] << 12) |
      (row2[2] << 11) |
      (row1[0] << 7) |
      (row1[1] << 6) |
      (row1[2] << 5) |
      (row1[3] << 4);

    for (j = 0; j < width; j++) {
      row[j] = pixel = decoder.readBit(contexts, contextLabel);

      // At each pixel: Clear contextLabel pixels that are shifted
      // out of the context, then add new ones.
      contextLabel =
        ((contextLabel & OLD_PIXEL_MASK) << 1) |
        (j + 3 < width ? row2[j + 3] << 11 : 0) |
        (j + 4 < width ? row1[j + 4] << 4 : 0) |
        pixel;
    }
  }

  return bitmap;
}

// 6.2 Generic Region Decoding Procedure
function decodeBitmap(
  mmr: boolean,
  width: number,
  height: number,
  templateIndex: number,
  prediction: boolean,
  skip: number[][] | null,
  at: { x: number; y: number; }[],
  decodingContext: DecodingContext
) {
  if (mmr) {
    const input = new Reader(
      decodingContext.data,
      decodingContext.start,
      decodingContext.end
    );
    return decodeMMRBitmap(input, width, height, false);
  }

  // Use optimized version for the most common case
  if (
    templateIndex === 0 &&
    !skip &&
    !prediction &&
    at.length === 4 &&
    at[0].x === 3 &&
    at[0].y === -1 &&
    at[1].x === -3 &&
    at[1].y === -1 &&
    at[2].x === 2 &&
    at[2].y === -2 &&
    at[3].x === -2 &&
    at[3].y === -2
  ) {
    return decodeBitmapTemplate0(width, height, decodingContext);
  }

  const useskip = !!skip;
  const template = CodingTemplates[templateIndex].concat(at);

  // Sorting is non-standard, and it is not required. But sorting increases
  // the number of template bits that can be reused from the previous
  // contextLabel in the main loop.
  template.sort(function (a, b) {
    return a.y - b.y || a.x - b.x;
  });

  const templateLength = template.length;
  const templateX = new Int8Array(templateLength);
  const templateY = new Int8Array(templateLength);
  const changingTemplateEntries = [];
  let reuseMask = 0,
    minX = 0,
    maxX = 0,
    minY = 0;
  let c, k;

  for (k = 0; k < templateLength; k++) {
    templateX[k] = template[k].x;
    templateY[k] = template[k].y;
    minX = Math.min(minX, template[k].x);
    maxX = Math.max(maxX, template[k].x);
    minY = Math.min(minY, template[k].y);
    // Check if the template pixel appears in two consecutive context labels,
    // so it can be reused. Otherwise, we add it to the list of changing
    // template entries.
    if (
      k < templateLength - 1 &&
      template[k].y === template[k + 1].y &&
      template[k].x === template[k + 1].x - 1
    ) {
      reuseMask |= 1 << (templateLength - 1 - k);
    } else {
      changingTemplateEntries.push(k);
    }
  }
  const changingEntriesLength = changingTemplateEntries.length;

  const changingTemplateX = new Int8Array(changingEntriesLength);
  const changingTemplateY = new Int8Array(changingEntriesLength);
  const changingTemplateBit = new Uint16Array(changingEntriesLength);
  for (c = 0; c < changingEntriesLength; c++) {
    k = changingTemplateEntries[c];
    changingTemplateX[c] = template[k].x;
    changingTemplateY[c] = template[k].y;
    changingTemplateBit[c] = 1 << (templateLength - 1 - k);
  }

  // Get the safe bounding box edges from the width, height, minX, maxX, minY
  const sbb_left = -minX;
  const sbb_top = -minY;
  const sbb_right = width - maxX;

  const pseudoPixelContext = ReusedContexts[templateIndex];
  let row = new Uint8Array(width);
  const bitmap = [];

  const decoder = decodingContext.decoder;
  const contexts = decodingContext.contextCache.getContexts("GB");

  let ltp = 0,
    j,
    i0,
    j0,
    contextLabel = 0,
    bit,
    shift;
  for (let i = 0; i < height; i++) {
    if (prediction) {
      const sltp = decoder.readBit(contexts, pseudoPixelContext);
      ltp ^= sltp;
      if (ltp) {
        bitmap.push(row); // duplicate previous row
        continue;
      }
    }
    row = new Uint8Array(row);
    bitmap.push(row);
    for (j = 0; j < width; j++) {
      if (useskip && skip[i][j]) {
        row[j] = 0;
        continue;
      }
      // Are we in the middle of a scanline, so we can reuse contextLabel
      // bits?
      if (j >= sbb_left && j < sbb_right && i >= sbb_top) {
        // If yes, we can just shift the bits that are reusable and only
        // fetch the remaining ones.
        contextLabel = (contextLabel << 1) & reuseMask;
        for (k = 0; k < changingEntriesLength; k++) {
          i0 = i + changingTemplateY[k];
          j0 = j + changingTemplateX[k];
          bit = bitmap[i0][j0];
          if (bit) {
            bit = changingTemplateBit[k];
            contextLabel |= bit;
          }
        }
      } else {
        // compute the contextLabel from scratch
        contextLabel = 0;
        shift = templateLength - 1;
        for (k = 0; k < templateLength; k++, shift--) {
          j0 = j + templateX[k];
          if (j0 >= 0 && j0 < width) {
            i0 = i + templateY[k];
            if (i0 >= 0) {
              bit = bitmap[i0][j0];
              if (bit) {
                contextLabel |= bit << shift;
              }
            }
          }
        }
      }
      const pixel = decoder.readBit(contexts, contextLabel);
      row[j] = pixel;
    }
  }
  return bitmap;
}

// 6.3.2 Generic Refinement Region Decoding Procedure
function decodeRefinement(
  width: number,
  height: number,
  templateIndex: number,
  referenceBitmap: Uint8Array[],
  offsetX: number,
  offsetY: number,
  prediction: boolean,
  at: { x: number; y: number; }[],
  decodingContext: DecodingContext
) {
  let codingTemplate = RefinementTemplates[templateIndex].coding;
  if (templateIndex === 0) {
    codingTemplate = codingTemplate.concat([at[0]]);
  }
  const codingTemplateLength = codingTemplate.length;
  const codingTemplateX = new Int32Array(codingTemplateLength);
  const codingTemplateY = new Int32Array(codingTemplateLength);
  let k;
  for (k = 0; k < codingTemplateLength; k++) {
    codingTemplateX[k] = codingTemplate[k].x;
    codingTemplateY[k] = codingTemplate[k].y;
  }

  let referenceTemplate = RefinementTemplates[templateIndex].reference;
  if (templateIndex === 0) {
    referenceTemplate = referenceTemplate.concat([at[1]]);
  }
  const referenceTemplateLength = referenceTemplate.length;
  const referenceTemplateX = new Int32Array(referenceTemplateLength);
  const referenceTemplateY = new Int32Array(referenceTemplateLength);
  for (k = 0; k < referenceTemplateLength; k++) {
    referenceTemplateX[k] = referenceTemplate[k].x;
    referenceTemplateY[k] = referenceTemplate[k].y;
  }
  const referenceWidth = referenceBitmap[0].length;
  const referenceHeight = referenceBitmap.length;

  const pseudoPixelContext = RefinementReusedContexts[templateIndex];
  const bitmap = [];

  const decoder = decodingContext.decoder;
  const contexts = decodingContext.contextCache.getContexts("GR");

  let ltp = 0;
  for (let i = 0; i < height; i++) {
    if (prediction) {
      const sltp = decoder.readBit(contexts, pseudoPixelContext);
      ltp ^= sltp;
      if (ltp) {
        throw new Jbig2Error("prediction is not supported");
      }
    }
    const row = new Uint8Array(width);
    bitmap.push(row);
    for (let j = 0; j < width; j++) {
      let i0, j0;
      let contextLabel = 0;
      for (k = 0; k < codingTemplateLength; k++) {
        i0 = i + codingTemplateY[k];
        j0 = j + codingTemplateX[k];
        if (i0 < 0 || j0 < 0 || j0 >= width) {
          contextLabel <<= 1; // out of bound pixel
        } else {
          contextLabel = (contextLabel << 1) | bitmap[i0][j0];
        }
      }
      for (k = 0; k < referenceTemplateLength; k++) {
        i0 = i + referenceTemplateY[k] - offsetY;
        j0 = j + referenceTemplateX[k] - offsetX;
        if (i0 < 0 || i0 >= referenceHeight || j0 < 0 || j0 >= referenceWidth) {
          contextLabel <<= 1; // out of bound pixel
        } else {
          contextLabel = (contextLabel << 1) | referenceBitmap[i0][j0];
        }
      }
      const pixel = decoder.readBit(contexts, contextLabel);
      row[j] = pixel;
    }
  }

  return bitmap;
}

// 6.5.5 Decoding the symbol dictionary
function decodeSymbolDictionary(
  huffman: boolean,
  refinement: boolean,
  symbols: Uint8Array<ArrayBuffer>[][],
  numberOfNewSymbols: number,
  _numberOfExportedSymbols: number,
  huffmanTables: {
    tableDeltaHeight: HuffmanTable;
    tableDeltaWidth: HuffmanTable;
    tableBitmapSize: HuffmanTable;
    tableAggregateInstances: HuffmanTable;
  } | null,
  templateIndex: number,
  at: { x: number; y: number; }[] | null,
  refinementTemplateIndex: number,
  refinementAt: { x: number; y: number; }[] | null,
  decodingContext: DecodingContext,
  huffmanInput: Reader
): Uint8Array<ArrayBuffer>[][] {
  if (huffman && refinement) {
    throw new Jbig2Error("symbol refinement with Huffman is not supported");
  }

  const newSymbols = [];
  let currentHeight = 0;
  let symbolCodeLength = log2(symbols.length + numberOfNewSymbols);

  const decoder = decodingContext.decoder;
  const contextCache = decodingContext.contextCache;
  let tableB1, symbolWidths: number[] | null;
  if (huffman) {
    tableB1 = getStandardTable(1); // standard table B.1
    symbolWidths = [];
    symbolCodeLength = Math.max(symbolCodeLength, 1); // 6.5.8.2.3
  }

  while (newSymbols.length < numberOfNewSymbols) {
    const deltaHeight = huffman
      ? huffmanTables!.tableDeltaHeight.decode(huffmanInput)!
      : decodeInteger(contextCache, "IADH", decoder)!; // 6.5.6
    currentHeight += deltaHeight;
    let currentWidth = 0,
      totalWidth = 0;
    const firstSymbol = huffman ? symbolWidths!.length : 0;
    while (true) {
      const deltaWidth = huffman
        ? huffmanTables!.tableDeltaWidth.decode(huffmanInput)
        : decodeInteger(contextCache, "IADW", decoder); // 6.5.7
      if (deltaWidth === null) {
        break; // OOB
      }
      currentWidth += deltaWidth;
      totalWidth += currentWidth;
      let bitmap;
      if (refinement) {
        // 6.5.8.2 Refinement/aggregate-coded symbol bitmap
        const numberOfInstances = decodeInteger(contextCache, "IAAI", decoder)!;
        if (numberOfInstances > 1) {
          bitmap = decodeTextRegion(
            huffman,
            refinement,
            currentWidth,
            currentHeight,
            0,
            numberOfInstances,
            1, // strip size
            symbols.concat(newSymbols),
            symbolCodeLength,
            0, // transposed
            0, // ds offset
            1, // top left 7.4.3.1.1
            0, // OR operator
            // TODO 这个点有点诡异，回头还要再看看，可能是bug，也可能是我没看懂
            // 用any过渡一下
            huffmanTables as any,
            refinementTemplateIndex,
            refinementAt,
            decodingContext,
            0,
            huffmanInput!
          );
        } else {
          const symbolId = decodeIAID(contextCache, decoder, symbolCodeLength);
          const rdx = decodeInteger(contextCache, "IARDX", decoder); // 6.4.11.3
          const rdy = decodeInteger(contextCache, "IARDY", decoder); // 6.4.11.4
          const symbol =
            symbolId < symbols.length
              ? symbols[symbolId]
              : newSymbols[symbolId - symbols.length];
          bitmap = decodeRefinement(
            currentWidth,
            currentHeight,
            refinementTemplateIndex,
            symbol,
            rdx!,
            rdy!,
            false,
            refinementAt!,
            decodingContext
          );
        }
        newSymbols.push(bitmap);
      } else if (huffman) {
        // Store only symbol width and decode a collective bitmap when the
        // height class is done.
        symbolWidths!.push(currentWidth);
      } else {
        // 6.5.8.1 Direct-coded symbol bitmap
        bitmap = decodeBitmap(
          false,
          currentWidth,
          currentHeight,
          templateIndex,
          false,
          null,
          at!,
          decodingContext
        );
        newSymbols.push(bitmap);
      }
    }
    if (huffman && !refinement) {
      // 6.5.9 Height class collective bitmap
      const bitmapSize = huffmanTables!.tableBitmapSize.decode(huffmanInput)!;
      huffmanInput.byteAlign();
      let collectiveBitmap;
      if (bitmapSize === 0) {
        // Uncompressed collective bitmap
        collectiveBitmap = readUncompressedBitmap(
          huffmanInput,
          totalWidth,
          currentHeight
        );
      } else {
        // MMR collective bitmap
        const originalEnd = huffmanInput.end;
        const bitmapEnd = huffmanInput.position + bitmapSize;
        huffmanInput.end = bitmapEnd;
        collectiveBitmap = decodeMMRBitmap(
          huffmanInput,
          totalWidth,
          currentHeight,
          false
        );
        huffmanInput.end = originalEnd;
        huffmanInput.position = bitmapEnd;
      }
      const numberOfSymbolsDecoded = symbolWidths!.length;
      if (firstSymbol === numberOfSymbolsDecoded - 1) {
        // collectiveBitmap is a single symbol.
        newSymbols.push(collectiveBitmap);
      } else {
        // Divide collectiveBitmap into symbols.
        let i,
          y,
          xMin = 0,
          xMax,
          bitmapWidth,
          symbolBitmap;
        for (i = firstSymbol; i < numberOfSymbolsDecoded; i++) {
          bitmapWidth = symbolWidths![i];
          xMax = xMin + bitmapWidth;
          symbolBitmap = [];
          for (y = 0; y < currentHeight; y++) {
            symbolBitmap.push(collectiveBitmap[y].subarray(xMin, xMax));
          }
          newSymbols.push(symbolBitmap);
          xMin = xMax;
        }
      }
    }
  }

  // 6.5.10 Exported symbols
  const exportedSymbols: Uint8Array<ArrayBuffer>[][] = [];
  const flags = [];
  let currentFlag = false;
  let i, ii;
  const totalSymbolsLength = symbols.length + numberOfNewSymbols;
  while (flags.length < totalSymbolsLength) {
    let runLength = huffman ? tableB1!.decode(huffmanInput)! : decodeInteger(contextCache, "IAEX", decoder)!;
    while (runLength--) {
      flags.push(currentFlag);
    }
    currentFlag = !currentFlag;
  }
  for (i = 0, ii = symbols.length; i < ii; i++) {
    if (flags[i]) {
      exportedSymbols.push(symbols[i]);
    }
  }
  for (let j = 0; j < numberOfNewSymbols; i++, j++) {
    if (flags[i]) {
      exportedSymbols.push(newSymbols[j]);
    }
  }
  return exportedSymbols;
}

function decodeTextRegion(
  huffman: boolean,
  refinement: boolean,
  width: number,
  height: number,
  defaultPixelValue: number,
  numberOfSymbolInstances: number,
  stripSize: number,
  inputSymbols: Uint8Array[][],
  symbolCodeLength: number,
  transposed: boolean | number,
  dsOffset: number,
  referenceCorner: number,
  combinationOperator: number,
  huffmanTables: {
    symbolIDTable: HuffmanTable;
    tableFirstS: HuffmanTable;
    tableDeltaS: HuffmanTable;
    tableDeltaT: HuffmanTable;
  },
  refinementTemplateIndex: number,
  refinementAt: {
    x: number;
    y: number;
  }[] | null,
  decodingContext: DecodingContext,
  logStripSize: number,
  huffmanInput: Reader
) {
  if (huffman && refinement) {
    throw new Jbig2Error("refinement with Huffman is not supported");
  }

  // Prepare bitmap
  const bitmap = [];
  let i, row;
  for (i = 0; i < height; i++) {
    row = new Uint8Array(width);
    if (defaultPixelValue) {
      for (let j = 0; j < width; j++) {
        row[j] = defaultPixelValue;
      }
    }
    bitmap.push(row);
  }

  const decoder = decodingContext.decoder;
  const contextCache = decodingContext.contextCache;

  let stripT = huffman
    ? -huffmanTables.tableDeltaT.decode(huffmanInput)!
    : -decodeInteger(contextCache, "IADT", decoder)!; // 6.4.6
  let firstS = 0;
  i = 0;
  while (i < numberOfSymbolInstances) {
    const deltaT = huffman
      ? huffmanTables.tableDeltaT.decode(huffmanInput)!
      : decodeInteger(contextCache, "IADT", decoder)!; // 6.4.6
    stripT += deltaT;

    const deltaFirstS = huffman
      ? huffmanTables.tableFirstS.decode(huffmanInput)!
      : decodeInteger(contextCache, "IAFS", decoder)!; // 6.4.7
    firstS += deltaFirstS;
    let currentS = firstS;
    do {
      let currentT = 0; // 6.4.9
      if (stripSize > 1) {
        currentT = huffman
          ? huffmanInput.readBits(logStripSize)
          : decodeInteger(contextCache, "IAIT", decoder)!;
      }
      const t = stripSize * stripT + currentT;
      const symbolId = huffman
        ? huffmanTables.symbolIDTable.decode(huffmanInput)!
        : decodeIAID(contextCache, decoder, symbolCodeLength)!;
      const applyRefinement =
        refinement &&
        (huffman
          ? huffmanInput.readBit()
          : decodeInteger(contextCache, "IARI", decoder));
      let symbolBitmap = inputSymbols[symbolId];
      let symbolWidth = symbolBitmap[0].length;
      let symbolHeight = symbolBitmap.length;
      if (applyRefinement) {
        const rdw = decodeInteger(contextCache, "IARDW", decoder)!; // 6.4.11.1
        const rdh = decodeInteger(contextCache, "IARDH", decoder)!; // 6.4.11.2
        const rdx = decodeInteger(contextCache, "IARDX", decoder)!; // 6.4.11.3
        const rdy = decodeInteger(contextCache, "IARDY", decoder)!; // 6.4.11.4
        symbolWidth += rdw;
        symbolHeight += rdh;
        symbolBitmap = decodeRefinement(
          symbolWidth,
          symbolHeight,
          refinementTemplateIndex,
          symbolBitmap,
          (rdw >> 1) + rdx,
          (rdh >> 1) + rdy,
          false,
          refinementAt!,
          decodingContext
        );
      }

      let increment = 0;
      if (!transposed) {
        if (referenceCorner > 1) {
          currentS += symbolWidth - 1;
        } else {
          increment = symbolWidth - 1;
        }
      } else if (!(referenceCorner & 1)) {
        currentS += symbolHeight - 1;
      } else {
        increment = symbolHeight - 1;
      }

      const offsetT = t - (referenceCorner & 1 ? 0 : symbolHeight - 1);
      const offsetS = currentS - (referenceCorner & 2 ? symbolWidth - 1 : 0);
      let s2, t2, symbolRow;
      if (transposed) {
        // Place Symbol Bitmap from T1,S1
        for (s2 = 0; s2 < symbolHeight; s2++) {
          row = bitmap[offsetS + s2];
          if (!row) {
            continue;
          }
          symbolRow = symbolBitmap[s2];
          // To ignore Parts of Symbol bitmap which goes
          // outside bitmap region
          const maxWidth = Math.min(width - offsetT, symbolWidth);
          switch (combinationOperator) {
            case 0: // OR
              for (t2 = 0; t2 < maxWidth; t2++) {
                row[offsetT + t2] |= symbolRow[t2];
              }
              break;
            case 2: // XOR
              for (t2 = 0; t2 < maxWidth; t2++) {
                row[offsetT + t2] ^= symbolRow[t2];
              }
              break;
            default:
              throw new Jbig2Error(
                `operator ${combinationOperator} is not supported`
              );
          }
        }
      } else {
        for (t2 = 0; t2 < symbolHeight; t2++) {
          row = bitmap[offsetT + t2];
          if (!row) {
            continue;
          }
          symbolRow = symbolBitmap[t2];
          switch (combinationOperator) {
            case 0: // OR
              for (s2 = 0; s2 < symbolWidth; s2++) {
                row[offsetS + s2] |= symbolRow[s2];
              }
              break;
            case 2: // XOR
              for (s2 = 0; s2 < symbolWidth; s2++) {
                row[offsetS + s2] ^= symbolRow[s2];
              }
              break;
            default:
              throw new Jbig2Error(
                `operator ${combinationOperator} is not supported`
              );
          }
        }
      }
      i++;
      const deltaS = huffman
        ? huffmanTables.tableDeltaS.decode(huffmanInput)
        : decodeInteger(contextCache, "IADS", decoder); // 6.4.8
      if (deltaS === null) {
        break; // OOB
      }
      currentS += increment + deltaS + dsOffset;
    } while (true);
  }
  return bitmap;
}

function decodePatternDictionary(
  mmr: boolean,
  patternWidth: number,
  patternHeight: number,
  maxPatternIndex: number,
  template: number,
  decodingContext: DecodingContext
) {
  const at = [];
  if (!mmr) {
    at.push({
      x: -patternWidth,
      y: 0,
    });
    if (template === 0) {
      at.push(
        {
          x: -3,
          y: -1,
        },
        {
          x: 2,
          y: -2,
        },
        {
          x: -2,
          y: -2,
        }
      );
    }
  }
  const collectiveWidth = (maxPatternIndex + 1) * patternWidth;
  const collectiveBitmap = decodeBitmap(
    mmr,
    collectiveWidth,
    patternHeight,
    template,
    false,
    null,
    at,
    decodingContext
  );
  // Divide collective bitmap into patterns.
  const patterns = [];
  for (let i = 0; i <= maxPatternIndex; i++) {
    const patternBitmap = [];
    const xMin = patternWidth * i;
    const xMax = xMin + patternWidth;
    for (let y = 0; y < patternHeight; y++) {
      patternBitmap.push(collectiveBitmap[y].subarray(xMin, xMax));
    }
    patterns.push(patternBitmap);
  }
  return patterns;
}

function decodeHalftoneRegion(
  mmr: boolean,
  patterns: Uint8Array[][],
  template: number,
  regionWidth: number,
  regionHeight: number,
  defaultPixelValue: number,
  enableSkip: boolean,
  combinationOperator: number,
  gridWidth: number,
  gridHeight: number,
  gridOffsetX: number,
  gridOffsetY: number,
  gridVectorX: number,
  gridVectorY: number,
  decodingContext: DecodingContext
) {
  const skip = null;
  if (enableSkip) {
    throw new Jbig2Error("skip is not supported");
  }
  if (combinationOperator !== 0) {
    throw new Jbig2Error(
      `operator "${combinationOperator}" is not supported in halftone region`
    );
  }

  // Prepare bitmap.
  const regionBitmap = [];
  let i, j, row;
  for (i = 0; i < regionHeight; i++) {
    row = new Uint8Array(regionWidth);
    if (defaultPixelValue) {
      for (j = 0; j < regionWidth; j++) {
        row[j] = defaultPixelValue;
      }
    }
    regionBitmap.push(row);
  }

  const numberOfPatterns = patterns.length;
  const pattern0 = patterns[0];
  const patternWidth = pattern0[0].length,
    patternHeight = pattern0.length;
  const bitsPerValue = log2(numberOfPatterns);
  const at = [];
  if (!mmr) {
    at.push({
      x: template <= 1 ? 3 : 2,
      y: -1,
    });
    if (template === 0) {
      at.push(
        {
          x: -3,
          y: -1,
        },
        {
          x: 2,
          y: -2,
        },
        {
          x: -2,
          y: -2,
        }
      );
    }
  }
  // Annex C. Gray-scale Image Decoding Procedure.
  const grayScaleBitPlanes = [];
  let mmrInput, bitmap;
  if (mmr) {
    // MMR bit planes are in one continuous stream. Only EOFB codes indicate
    // the end of each bitmap, so EOFBs must be decoded.
    mmrInput = new Reader(
      decodingContext.data,
      decodingContext.start,
      decodingContext.end
    );
  }
  for (i = bitsPerValue - 1; i >= 0; i--) {
    if (mmr) {
      bitmap = decodeMMRBitmap(mmrInput!, gridWidth, gridHeight, true);
    } else {
      bitmap = decodeBitmap(
        false,
        gridWidth,
        gridHeight,
        template,
        false,
        skip,
        at,
        decodingContext
      );
    }
    grayScaleBitPlanes[i] = bitmap;
  }
  // 6.6.5.2 Rendering the patterns.
  let mg, ng, bit, patternIndex, patternBitmap, x, y, patternRow, regionRow;
  for (mg = 0; mg < gridHeight; mg++) {
    for (ng = 0; ng < gridWidth; ng++) {
      bit = 0;
      patternIndex = 0;
      for (j = bitsPerValue - 1; j >= 0; j--) {
        bit ^= grayScaleBitPlanes[j][mg][ng]; // Gray decoding
        patternIndex |= bit << j;
      }
      patternBitmap = patterns[patternIndex];
      x = (gridOffsetX + mg * gridVectorY + ng * gridVectorX) >> 8;
      y = (gridOffsetY + mg * gridVectorX - ng * gridVectorY) >> 8;
      // Draw patternBitmap at (x, y).
      if (
        x >= 0 &&
        x + patternWidth <= regionWidth &&
        y >= 0 &&
        y + patternHeight <= regionHeight
      ) {
        for (i = 0; i < patternHeight; i++) {
          regionRow = regionBitmap[y + i];
          patternRow = patternBitmap[i];
          for (j = 0; j < patternWidth; j++) {
            regionRow[x + j] |= patternRow[j];
          }
        }
      } else {
        let regionX, regionY;
        for (i = 0; i < patternHeight; i++) {
          regionY = y + i;
          if (regionY < 0 || regionY >= regionHeight) {
            continue;
          }
          regionRow = regionBitmap[regionY];
          patternRow = patternBitmap[i];
          for (j = 0; j < patternWidth; j++) {
            regionX = x + j;
            if (regionX >= 0 && regionX < regionWidth) {
              regionRow[regionX] |= patternRow[j];
            }
          }
        }
      }
    }
  }
  return regionBitmap;
}

interface SegmentHeaderType {
  number?: number,
  type?: number,
  typeName?: SegmentType | null,
  deferredNonRetain?: boolean,
  retainBits?: number[],
  referredTo?: number[],
  length?: number;
  pageAssociation?: number;
  headerEnd?: number;
}

function readSegmentHeader(data: Uint8TypedArray, start: number): SegmentHeaderType {
  const segmentHeader: SegmentHeaderType = {};
  segmentHeader.number = readUint32(data, start);
  const flags = data[start + 4];
  const segmentType = flags & 0x3f;
  if (!SegmentTypes[segmentType]) {
    throw new Jbig2Error("invalid segment type: " + segmentType);
  }
  segmentHeader.type = segmentType;
  segmentHeader.typeName = SegmentTypes[segmentType];
  segmentHeader.deferredNonRetain = !!(flags & 0x80);

  const pageAssociationFieldSize = !!(flags & 0x40);
  const referredFlags = data[start + 5];
  let referredToCount = (referredFlags >> 5) & 7;
  const retainBits = [referredFlags & 31];
  let position = start + 6;
  if (referredFlags === 7) {
    referredToCount = readUint32(data, position - 1) & 0x1fffffff;
    position += 3;
    let bytes = (referredToCount + 7) >> 3;
    retainBits[0] = data[position++];
    while (--bytes > 0) {
      retainBits.push(data[position++]);
    }
  } else if (referredFlags === 5 || referredFlags === 6) {
    throw new Jbig2Error("invalid referred-to flags");
  }

  segmentHeader.retainBits = retainBits;

  let referredToSegmentNumberSize = 4;
  if (segmentHeader.number <= 256) {
    referredToSegmentNumberSize = 1;
  } else if (segmentHeader.number <= 65536) {
    referredToSegmentNumberSize = 2;
  }
  const referredTo: number[] = [];
  let i, ii;
  for (i = 0; i < referredToCount; i++) {
    let number;
    if (referredToSegmentNumberSize === 1) {
      number = data[position];
    } else if (referredToSegmentNumberSize === 2) {
      number = readUint16(data, position);
    } else {
      number = readUint32(data, position);
    }
    referredTo.push(number);
    position += referredToSegmentNumberSize;
  }
  segmentHeader.referredTo = referredTo;
  if (!pageAssociationFieldSize) {
    segmentHeader.pageAssociation = data[position++];
  } else {
    segmentHeader.pageAssociation = readUint32(data, position);
    position += 4;
  }
  segmentHeader.length = readUint32(data, position);
  position += 4;

  if (segmentHeader.length === 0xffffffff) {
    // 7.2.7 Segment data length, unknown segment length
    if (segmentType === 38) {
      // ImmediateGenericRegion
      const genericRegionInfo = readRegionSegmentInformation(data, position);
      const genericRegionSegmentFlags =
        data[position + RegionSegmentInformationFieldLength];
      const genericRegionMmr = !!(genericRegionSegmentFlags & 1);
      // searching for the segment end
      const searchPatternLength = 6;
      const searchPattern = new Uint8Array(searchPatternLength);
      if (!genericRegionMmr) {
        searchPattern[0] = 0xff;
        searchPattern[1] = 0xac;
      }
      searchPattern[2] = (genericRegionInfo.height >>> 24) & 0xff;
      searchPattern[3] = (genericRegionInfo.height >> 16) & 0xff;
      searchPattern[4] = (genericRegionInfo.height >> 8) & 0xff;
      searchPattern[5] = genericRegionInfo.height & 0xff;
      for (i = position, ii = data.length; i < ii; i++) {
        let j = 0;
        while (j < searchPatternLength && searchPattern[j] === data[i + j]) {
          j++;
        }
        if (j === searchPatternLength) {
          segmentHeader.length = i + searchPatternLength;
          break;
        }
      }
      if (segmentHeader.length === 0xffffffff) {
        throw new Jbig2Error("segment end was not found");
      }
    } else {
      throw new Jbig2Error("invalid unknown segment length");
    }
  }
  segmentHeader.headerEnd = position;
  return segmentHeader;
}

interface SegmentWrapper {
  header: SegmentHeaderType;
  data: Uint8TypedArray;
  start?: number;
  end?: number;
}

function readSegments(randomAccess: boolean, data: Uint8TypedArray, start: number, end: number) {
  const segments: SegmentWrapper[] = [];
  let position = start;
  while (position < end) {
    const segmentHeader = readSegmentHeader(data, position);
    position = segmentHeader.headerEnd!;
    const segment: SegmentWrapper = {
      header: segmentHeader, data
    };
    if (!randomAccess) {
      segment.start = position;
      position += segmentHeader.length!;
      segment.end = position;
    }
    segments.push(segment);
    if (segmentHeader.type === 51) {
      break; // end of file is found
    }
  }
  if (randomAccess) {
    for (let i = 0, ii = segments.length; i < ii; i++) {
      segments[i].start = position;
      position += segments[i].header.length!;
      segments[i].end = position;
    }
  }
  return segments;
}

// 7.4.1 Region segment information field
function readRegionSegmentInformation(data: Uint8TypedArray, start: number) {
  return {
    width: readUint32(data, start),
    height: readUint32(data, start + 4),
    x: readUint32(data, start + 8),
    y: readUint32(data, start + 12),
    combinationOperator: data[start + 16] & 7,
  };
}
const RegionSegmentInformationFieldLength = 17;

interface SegmentDictionary {
  huffman: boolean,
  refinement: boolean;
  huffmanDHSelector: number;
  huffmanDWSelector: number;
  bitmapSizeSelector: number;
  aggregationInstancesSelector: number;
  bitmapCodingContextUsed: boolean;
  bitmapCodingContextRetained: boolean;
  template: number;
  refinementTemplate: number
  at: { x: number; y: number; }[] | null;
  refinementAt: { x: number; y: number; }[] | null;
  numberOfNewSymbols: number;
  numberOfExportedSymbols: number;
}

interface SegmentTextRegion {
  numberOfSymbolInstances: number;
  refinementAt: { x: number; y: number; }[] | null;
  refinementTemplate: number;
  dsOffset: number;
  defaultPixelValue: number;
  combinationOperator: number;
  transposed: boolean;
  referenceCorner: number;
  stripSize: number;
  logStripSize: number;
  refinement: boolean;
  info: { width: number; height: number; x: number; y: number; combinationOperator: number; };
  huffman: boolean;
  huffmanRefinementSizeSelector: boolean | null;
  huffmanRefinementDY: number | null;
  huffmanRefinementDX: number | null;
  huffmanRefinementDH: number | null;
  huffmanRefinementDW: number | null;
  huffmanDT: number | null;
  huffmanDS: number | null;
  huffmanFS: number | null;
}

interface SegmentPatternDictionary {
  mmr: boolean;
  template: number;
  patternWidth: number;
  patternHeight: number;
  maxPatternIndex: number;
}

interface SegmentHalftoneRegion {
  gridVectorX: number;
  gridVectorY: number;
  gridOffsetY: number;
  gridOffsetX: number;
  gridHeight: number;
  gridWidth: number;
  defaultPixelValue: number;
  combinationOperator: number;
  enableSkip: boolean;
  template: number;
  mmr: boolean;
  info: { width: number; height: number; x: number; y: number; combinationOperator: number; };
}

interface SegmentGenericRegion {
  at: { x: number; y: number; }[] | null;
  prediction: boolean;
  template: number;
  mmr: boolean;
  info: { width: number; height: number; x: number; y: number; combinationOperator: number; };
}

interface SegmentPageInfo {
  width: number;
  height: number | null;
  resolutionX: number;
  resolutionY: number;
  lossless: boolean;
  refinement: boolean;
  defaultPixelValue: number;
  combinationOperator: number;
  requiresBuffer: boolean;
  combinationOperatorOverride: boolean;
}

function processSegment(segment: SegmentWrapper, visitor: SimpleSegmentVisitor) {
  const header = segment.header;
  const data = segment.data, end = segment.end;
  let position = segment.start!;
  let args: unknown[] = [], at, i, atLength;
  switch (header.type) {
    case 0: // SymbolDictionary
      // 7.4.2 Symbol dictionary segment syntax
      const dictionaryFlags = readUint16(data, position); // 7.4.2.1.1
      const dictionary: SegmentDictionary = {
        huffman: !!(dictionaryFlags & 1),
        refinement: !!(dictionaryFlags & 2),
        huffmanDHSelector: (dictionaryFlags >> 2) & 3,
        huffmanDWSelector: (dictionaryFlags >> 4) & 3,
        bitmapSizeSelector: (dictionaryFlags >> 6) & 1,
        aggregationInstancesSelector: (dictionaryFlags >> 7) & 1,
        bitmapCodingContextUsed: !!(dictionaryFlags & 256),
        bitmapCodingContextRetained: !!(dictionaryFlags & 512),
        template: (dictionaryFlags >> 10) & 3,
        refinementTemplate: (dictionaryFlags >> 12) & 1,
        at: null,
        refinementAt: null,
        numberOfNewSymbols: 0,
        numberOfExportedSymbols: 0
      }
      position += 2;
      if (!dictionary.huffman) {
        atLength = dictionary.template === 0 ? 4 : 1;
        at = [];
        for (i = 0; i < atLength; i++) {
          at.push({
            x: readInt8(data, position),
            y: readInt8(data, position + 1),
          });
          position += 2;
        }
        dictionary.at = at;
      }
      if (dictionary.refinement && !dictionary.refinementTemplate) {
        at = [];
        for (i = 0; i < 2; i++) {
          at.push({
            x: readInt8(data, position),
            y: readInt8(data, position + 1),
          });
          position += 2;
        }
        dictionary.refinementAt = at;
      }
      dictionary.numberOfExportedSymbols = readUint32(data, position);
      position += 4;
      dictionary.numberOfNewSymbols = readUint32(data, position);
      position += 4;
      args = [
        dictionary,
        header.number,
        header.referredTo,
        data,
        position,
        end,
      ];
      break;
    case 6: // ImmediateTextRegion
    case 7: // ImmediateLosslessTextRegion
      // 这两行代码移动了位置
      position += RegionSegmentInformationFieldLength;
      const textRegionSegmentFlags = readUint16(data, position);
      position += 2;
      const logStripSize = (textRegionSegmentFlags >> 2) & 3;
      const textRegion: SegmentTextRegion = {
        info: readRegionSegmentInformation(data, position),
        huffman: !!(textRegionSegmentFlags & 1),
        refinement: !!(textRegionSegmentFlags & 2),
        logStripSize: logStripSize,
        stripSize: 1 << logStripSize,
        referenceCorner: (textRegionSegmentFlags >> 4) & 3,
        transposed: !!(textRegionSegmentFlags & 64),
        combinationOperator: (textRegionSegmentFlags >> 7) & 3,
        defaultPixelValue: (textRegionSegmentFlags >> 9) & 1,
        dsOffset: (textRegionSegmentFlags << 17) >> 27,
        refinementTemplate: (textRegionSegmentFlags >> 15) & 1,
        huffmanRefinementSizeSelector: null,
        huffmanRefinementDY: null,
        huffmanRefinementDX: null,
        huffmanRefinementDH: null,
        huffmanRefinementDW: null,
        huffmanDT: null,
        huffmanDS: null,
        huffmanFS: null,
        numberOfSymbolInstances: 0,
        refinementAt: null
      }
      if (textRegion.huffman) {
        const textRegionHuffmanFlags = readUint16(data, position);
        position += 2;
        textRegion.huffmanFS = textRegionHuffmanFlags & 3;
        textRegion.huffmanDS = (textRegionHuffmanFlags >> 2) & 3;
        textRegion.huffmanDT = (textRegionHuffmanFlags >> 4) & 3;
        textRegion.huffmanRefinementDW = (textRegionHuffmanFlags >> 6) & 3;
        textRegion.huffmanRefinementDH = (textRegionHuffmanFlags >> 8) & 3;
        textRegion.huffmanRefinementDX = (textRegionHuffmanFlags >> 10) & 3;
        textRegion.huffmanRefinementDY = (textRegionHuffmanFlags >> 12) & 3;
        textRegion.huffmanRefinementSizeSelector = !!(
          textRegionHuffmanFlags & 0x4000
        );
      }
      if (textRegion.refinement && !textRegion.refinementTemplate) {
        at = [];
        for (i = 0; i < 2; i++) {
          at.push({
            x: readInt8(data, position),
            y: readInt8(data, position + 1),
          });
          position += 2;
        }
        textRegion.refinementAt = at;
      }
      textRegion.numberOfSymbolInstances = readUint32(data, position);
      position += 4;
      args = [textRegion, header.referredTo, data, position, end];
      break;
    case 16: // PatternDictionary
      // 7.4.4. Pattern dictionary segment syntax
      const patternDictionaryFlags = data[position++];
      const patternDictionary: SegmentPatternDictionary = {
        mmr: !!(patternDictionaryFlags & 1),
        template: (patternDictionaryFlags >> 1) & 3,
        patternWidth: data[position++],
        patternHeight: data[position++],
        maxPatternIndex: readUint32(data, position),
      }
      position += 4;
      args = [patternDictionary, header.number, data, position, end];
      break;
    case 22: // ImmediateHalftoneRegion
    case 23: // ImmediateLosslessHalftoneRegion
      {
        // 7.4.5 Halftone region segment syntax
        const info = readRegionSegmentInformation(data, position);
        position += RegionSegmentInformationFieldLength;
        const halftoneRegionFlags = data[position++];
        const mmr = !!(halftoneRegionFlags & 1);
        const template = (halftoneRegionFlags >> 1) & 3;
        const enableSkip = !!(halftoneRegionFlags & 8);
        const combinationOperator = (halftoneRegionFlags >> 4) & 7;
        const defaultPixelValue = (halftoneRegionFlags >> 7) & 1;
        const gridWidth = readUint32(data, position);
        position += 4;
        const gridHeight = readUint32(data, position);
        position += 4;
        const gridOffsetX = readUint32(data, position) & 0xffffffff;
        position += 4;
        const gridOffsetY = readUint32(data, position) & 0xffffffff;
        position += 4;
        const gridVectorX = readUint16(data, position);
        position += 2;
        const gridVectorY = readUint16(data, position);
        position += 2;
        const halftoneRegion: SegmentHalftoneRegion = {
          info, mmr, template, enableSkip, combinationOperator, defaultPixelValue,
          gridWidth, gridHeight, gridOffsetX, gridOffsetY, gridVectorX, gridVectorY
        };
        args = [halftoneRegion, header.referredTo, data, position, end];
      }
      break;
    case 38: // ImmediateGenericRegion
    case 39: // ImmediateLosslessGenericRegion
      {
        const info = readRegionSegmentInformation(data, position);
        position += RegionSegmentInformationFieldLength;
        const genericRegionSegmentFlags = data[position++];
        const mmr = !!(genericRegionSegmentFlags & 1);
        const template = (genericRegionSegmentFlags >> 1) & 3;
        const prediction = !!(genericRegionSegmentFlags & 8);
        if (!mmr) {
          atLength = template === 0 ? 4 : 1;
          at = [];
          for (i = 0; i < atLength; i++) {
            at.push({
              x: readInt8(data, position),
              y: readInt8(data, position + 1),
            });
            position += 2;
          }
          // genericRegion.at = at;
        }
        const genericRegion: SegmentGenericRegion = {
          info, mmr, template, prediction, at: !mmr ? at! : null,
        };
        args = [genericRegion, data, position, end];
      }
      break;
    case 48: // PageInformation
      const pageInfo = {
        width: readUint32(data, position),
        height: <number | null>readUint32(data, position + 4),
        resolutionX: readUint32(data, position + 8),
        resolutionY: readUint32(data, position + 12),
      };
      if (pageInfo.height === 0xffffffff) {
        // delete pageInfo.height;
        pageInfo.height = null;
      }
      const pageSegmentFlags = data[position + 16];
      readUint16(data, position + 17); // pageStripingInformation
      const lossless = !!(pageSegmentFlags & 1);
      const refinement = !!(pageSegmentFlags & 2);
      const defaultPixelValue = (pageSegmentFlags >> 2) & 1;
      const combinationOperator = (pageSegmentFlags >> 3) & 3;
      const requiresBuffer = !!(pageSegmentFlags & 32);
      const combinationOperatorOverride = !!(pageSegmentFlags & 64);
      const segmentPageInfo: SegmentPageInfo = {
        width: pageInfo.width,
        height: pageInfo.height,
        resolutionX: pageInfo.resolutionX,
        resolutionY: pageInfo.resolutionY,
        lossless, refinement, defaultPixelValue,
        combinationOperator, requiresBuffer, combinationOperatorOverride
      }
      args = [segmentPageInfo];
      break;
    case 49: // EndOfPage
      break;
    case 50: // EndOfStripe
      break;
    case 51: // EndOfFile
      break;
    case 53: // Tables
      args = [header.number, data, position, end];
      break;
    case 62: // 7.4.15 defines 2 extension types which
      // are comments and can be ignored.
      break;
    default:
      throw new Jbig2Error(
        `segment type ${header.typeName}(${header.type}) is not implemented`
      );
  }
  const callback = header.typeName;
  if (callback != null) {
    // eslint-disable-next-line prefer-spread
    visitor.callback(callback, args);
  }
}

function processSegments(segments: SegmentWrapper[], visitor: SimpleSegmentVisitor) {
  for (let i = 0, ii = segments.length; i < ii; i++) {
    processSegment(segments[i], visitor);
  }
}

function parseJbig2Chunks(chunks: { data: Uint8TypedArray, start: number, end: number }[]) {
  const visitor = new SimpleSegmentVisitor();
  for (let i = 0, ii = chunks.length; i < ii; i++) {
    const chunk = chunks[i];
    const segments = readSegments(false, chunk.data, chunk.start, chunk.end);
    processSegments(segments, visitor);
  }
  return visitor.buffer;
}

function parseJbig2(data: Uint8TypedArray) {
  if (PlatformHelper.hasImageDecoders()) {
    throw new Error("Not implemented: parseJbig2");
  }
  const end = data.length;
  let position = 0;

  if (
    data[position] !== 0x97 ||
    data[position + 1] !== 0x4a ||
    data[position + 2] !== 0x42 ||
    data[position + 3] !== 0x32 ||
    data[position + 4] !== 0x0d ||
    data[position + 5] !== 0x0a ||
    data[position + 6] !== 0x1a ||
    data[position + 7] !== 0x0a
  ) {
    throw new Jbig2Error("parseJbig2 - invalid header.");
  }

  const header: { randomAccess?: boolean, numberOfPages?: number } = Object.create(null);
  position += 8;
  const flags = data[position++];
  header.randomAccess = !(flags & 1);
  if (!(flags & 2)) {
    header.numberOfPages = readUint32(data, position);
    position += 4;
  }

  const segments = readSegments(header.randomAccess, data, position, end);
  const visitor = new SimpleSegmentVisitor();
  processSegments(segments, visitor);

  const { width, height } = visitor.currentPageInfo!;
  const bitPacked = visitor.buffer;
  const imgData = new Uint8ClampedArray(width * height!);
  let q = 0, k = 0;
  for (let i = 0; i < height!; i++) {
    let mask = 0, buffer;
    for (let j = 0; j < width; j++) {
      if (!mask) {
        mask = 128;
        buffer = bitPacked![k++];
      }
      imgData[q++] = buffer! & mask ? 0 : 255;
      mask >>= 1;
    }
  }

  return { imgData, width, height: <number | null>height };
}

class SimpleSegmentVisitor {

  protected symbols: Record<number, Uint8Array<ArrayBuffer>[][]> | null = null;

  public buffer: Uint8ClampedArray | null = null;

  public currentPageInfo: SegmentPageInfo | null = null;

  protected customTables: Record<number, HuffmanTable> | null = null;

  protected patterns: Record<number, Uint8Array<ArrayBuffer>[][]> | null = null;

  public callback(segment: SegmentType, args: unknown[]) {

  }

  onPageInformation(info: SegmentPageInfo) {
    this.currentPageInfo = info;
    const rowSize = (info.width + 7) >> 3;
    const buffer = new Uint8ClampedArray(rowSize * info.height!);
    // The contents of ArrayBuffers are initialized to 0.
    // Fill the buffer with 0xFF only if info.defaultPixelValue is set
    if (info.defaultPixelValue) {
      buffer.fill(0xff);
    }
    this.buffer = buffer;
  }

  drawBitmap(
    regionInfo: {
      width: number;
      height: number;
      x: number;
      y: number;
      combinationOperator: number;
    }, bitmap: Uint8Array[]) {
    const pageInfo = this.currentPageInfo!;
    const width = regionInfo.width,
      height = regionInfo.height;
    const rowSize = (pageInfo.width + 7) >> 3;
    const combinationOperator = pageInfo.combinationOperatorOverride
      ? regionInfo.combinationOperator
      : pageInfo.combinationOperator;
    const buffer = this.buffer!;
    const mask0 = 128 >> (regionInfo.x & 7);
    let offset0 = regionInfo.y * rowSize + (regionInfo.x >> 3);
    let i, j, mask, offset;
    switch (combinationOperator) {
      case 0: // OR
        for (i = 0; i < height; i++) {
          mask = mask0;
          offset = offset0;
          for (j = 0; j < width; j++) {
            if (bitmap[i][j]) {
              buffer[offset] |= mask;
            }
            mask >>= 1;
            if (!mask) {
              mask = 128;
              offset++;
            }
          }
          offset0 += rowSize;
        }
        break;
      case 2: // XOR
        for (i = 0; i < height; i++) {
          mask = mask0;
          offset = offset0;
          for (j = 0; j < width; j++) {
            if (bitmap[i][j]) {
              buffer[offset] ^= mask;
            }
            mask >>= 1;
            if (!mask) {
              mask = 128;
              offset++;
            }
          }
          offset0 += rowSize;
        }
        break;
      default:
        throw new Jbig2Error(
          `operator ${combinationOperator} is not supported`
        );
    }
  }

  onImmediateGenericRegion(region: SegmentGenericRegion, data: Uint8TypedArray, start: number, end: number) {
    const regionInfo = region.info;
    const decodingContext = new DecodingContext(data, start, end);
    const bitmap = decodeBitmap(
      region.mmr,
      regionInfo.width,
      regionInfo.height,
      region.template,
      region.prediction,
      null,
      region.at!,
      decodingContext
    );
    this.drawBitmap(regionInfo, bitmap);
  }

  onImmediateLosslessGenericRegion() {
    const [region, data, start, end] = arguments as unknown as [
      SegmentGenericRegion, Uint8TypedArray, number, number
    ]
    this.onImmediateGenericRegion(region, data, start, end);
  }


  // on开头的，都是通过反射来进行调用的。
  // 连个注册的地方都没有，很容易就跟丢了。
  onSymbolDictionary(
    dictionary: SegmentDictionary,
    currentSegment: number,
    referredSegments: number[],
    data: Uint8TypedArray,
    start: number,
    end: number
  ) {
    let huffmanTables: {
      tableDeltaHeight: HuffmanTable;
      tableDeltaWidth: HuffmanTable;
      tableBitmapSize: HuffmanTable;
      tableAggregateInstances: HuffmanTable;
    } | null = null;
    let huffmanInput: Reader | null = null;
    if (dictionary.huffman) {
      huffmanTables = getSymbolDictionaryHuffmanTables(
        dictionary,
        referredSegments,
        this.customTables!
      );
      huffmanInput = new Reader(data, start, end);
    }

    // Combines exported symbols from all referred segments
    let symbols = this.symbols;
    if (!symbols) {
      this.symbols = symbols = {};
    }

    const inputSymbols: Uint8Array<ArrayBuffer>[][] = [];
    for (const referredSegment of referredSegments) {
      const referredSymbols = symbols[referredSegment];
      // referredSymbols is undefined when we have a reference to a Tables
      // segment instead of a SymbolDictionary.
      if (referredSymbols) {
        inputSymbols.push(...referredSymbols);
      }
    }

    const decodingContext = new DecodingContext(data, start, end);
    symbols[currentSegment] = decodeSymbolDictionary(
      dictionary.huffman,
      dictionary.refinement,
      inputSymbols,
      dictionary.numberOfNewSymbols,
      dictionary.numberOfExportedSymbols,
      huffmanTables,
      dictionary.template,
      dictionary.at,
      dictionary.refinementTemplate,
      dictionary.refinementAt,
      decodingContext,
      huffmanInput!
    );
  }

  onImmediateTextRegion(
    region: SegmentTextRegion,
    referredSegments: number[],
    data: Uint8TypedArray,
    start: number,
    end: number
  ) {
    const regionInfo = region.info;
    let huffmanTables: {
      symbolIDTable: HuffmanTable;
      tableFirstS: HuffmanTable;
      tableDeltaS: HuffmanTable;
      tableDeltaT: HuffmanTable;
    } | null = null;
    let huffmanInput;

    // Combines exported symbols from all referred segments
    const symbols = this.symbols!;
    const inputSymbols = [];
    for (const referredSegment of referredSegments) {
      const referredSymbols = symbols[referredSegment];
      // referredSymbols is undefined when we have a reference to a Tables
      // segment instead of a SymbolDictionary.
      if (referredSymbols) {
        inputSymbols.push(...referredSymbols);
      }
    }
    const symbolCodeLength = log2(inputSymbols.length);
    if (region.huffman) {
      huffmanInput = new Reader(data, start, end);
      huffmanTables = getTextRegionHuffmanTables(
        region,
        referredSegments,
        this.customTables!,
        inputSymbols.length,
        huffmanInput
      );
    }

    const decodingContext = new DecodingContext(data, start, end);
    const bitmap = decodeTextRegion(
      region.huffman,
      region.refinement,
      regionInfo.width,
      regionInfo.height,
      region.defaultPixelValue,
      region.numberOfSymbolInstances,
      region.stripSize,
      inputSymbols,
      symbolCodeLength,
      region.transposed,
      region.dsOffset,
      region.referenceCorner,
      region.combinationOperator,
      huffmanTables!,
      region.refinementTemplate,
      region.refinementAt,
      decodingContext,
      region.logStripSize,
      huffmanInput!
    );
    this.drawBitmap(regionInfo, bitmap);
  }

  onImmediateLosslessTextRegion() {
    const [region, referredSegments, data, start, end] = arguments as unknown as [
      SegmentTextRegion, number[], Uint8TypedArray, number, number
    ]
    this.onImmediateTextRegion(region, referredSegments, data, start, end);
  }

  onPatternDictionary(
    dictionary: SegmentPatternDictionary,
    currentSegment: number,
    data: Uint8TypedArray,
    start: number,
    end: number
  ) {
    let patterns = this.patterns;
    if (!patterns) {
      this.patterns = patterns = {};
    }
    const decodingContext = new DecodingContext(data, start, end);
    patterns[currentSegment] = decodePatternDictionary(
      dictionary.mmr,
      dictionary.patternWidth,
      dictionary.patternHeight,
      dictionary.maxPatternIndex,
      dictionary.template,
      decodingContext
    );
  }

  onImmediateHalftoneRegion(
    region: SegmentHalftoneRegion, referredSegments: number[],
    data: Uint8TypedArray, start: number, end: number
  ) {
    // HalftoneRegion refers to exactly one PatternDictionary.
    const patterns = this.patterns![referredSegments[0]];
    const regionInfo = region.info;
    const decodingContext = new DecodingContext(data, start, end);
    const bitmap = decodeHalftoneRegion(
      region.mmr,
      patterns,
      region.template,
      regionInfo.width,
      regionInfo.height,
      region.defaultPixelValue,
      region.enableSkip,
      region.combinationOperator,
      region.gridWidth,
      region.gridHeight,
      region.gridOffsetX,
      region.gridOffsetY,
      region.gridVectorX,
      region.gridVectorY,
      decodingContext
    );
    this.drawBitmap(regionInfo, bitmap);
  }

  onImmediateLosslessHalftoneRegion() {
    const [region, referredSegments, data, start, end] = arguments as unknown as [
      SegmentHalftoneRegion, number[], Uint8TypedArray, number, number
    ];
    this.onImmediateHalftoneRegion(region, referredSegments, data, start, end);
  }

  onTables(
    currentSegment: number,
    data: Uint8TypedArray,
    start: number,
    end: number
  ) {
    let customTables = this.customTables;
    if (!customTables) {
      this.customTables = customTables = {};
    }
    customTables[currentSegment] = decodeTablesSegment(data, start, end);
  }
}

type HuffmanLineParamType = [number, number] | [number, number, number, number] | [number, number, number, number, string];

class HuffmanLine {

  public isOOB: boolean;

  public rangeLow: number;

  public prefixLength: number;

  public rangeLength: number;

  public prefixCode: number;

  public isLowerRange: boolean;

  constructor(lineData: HuffmanLineParamType) {
    if (lineData.length === 2) {
      // OOB line.
      this.isOOB = true;
      this.rangeLow = 0;
      this.prefixLength = lineData[0];
      this.rangeLength = 0;
      this.prefixCode = lineData[1];
      this.isLowerRange = false;
    } else {
      // Normal, upper range or lower range line.
      // Upper range lines are processed like normal lines.
      this.isOOB = false;
      this.rangeLow = lineData[0];
      this.prefixLength = lineData[1];
      this.rangeLength = lineData[2];
      this.prefixCode = lineData[3];
      this.isLowerRange = lineData[4] === "lower";
    }
  }
}

class HuffmanTreeNode {

  protected children: HuffmanTreeNode[];

  protected isLeaf: boolean;

  protected rangeLength: number | null;

  protected rangeLow: number | null;

  protected isLowerRange: boolean | null;

  protected isOOB: boolean | null;

  constructor(line: HuffmanLine | null) {
    this.children = [];
    if (line) {
      // Leaf node
      this.isLeaf = true;
      this.rangeLength = line.rangeLength;
      this.rangeLow = line.rangeLow;
      this.isLowerRange = line.isLowerRange;
      this.isOOB = line.isOOB;
    } else {
      // Intermediate or root node
      this.isLeaf = false;
      this.rangeLength = null;
      this.rangeLow = null;
      this.isLowerRange = null;
      this.isOOB = null;
    }
  }

  buildTree(line: HuffmanLine, shift: number) {
    const bit = (line.prefixCode >> shift) & 1;
    if (shift <= 0) {
      // Create a leaf node.
      this.children[bit] = new HuffmanTreeNode(line);
    } else {
      // Create an intermediate node and continue recursively.
      let node = this.children[bit];
      if (!node) {
        this.children[bit] = node = new HuffmanTreeNode(null);
      }
      node.buildTree(line, shift - 1);
    }
  }

  decodeNode(reader: Reader): number | null {
    if (this.isLeaf) {
      if (this.isOOB) {
        return null;
      }
      const htOffset = reader.readBits(this.rangeLength!);
      return this.rangeLow! + (this.isLowerRange ? -htOffset : htOffset);
    }
    const node = this.children[reader.readBit()];
    if (!node) {
      throw new Jbig2Error("invalid Huffman data");
    }
    return node.decodeNode(reader);
  }
}

class HuffmanTable {
  rootNode: HuffmanTreeNode;
  constructor(lines: HuffmanLine[], prefixCodesDone: boolean) {
    if (!prefixCodesDone) {
      this.assignPrefixCodes(lines);
    }
    // Create Huffman tree.
    this.rootNode = new HuffmanTreeNode(null);
    for (let i = 0, ii = lines.length; i < ii; i++) {
      const line = lines[i];
      if (line.prefixLength > 0) {
        this.rootNode.buildTree(line, line.prefixLength - 1);
      }
    }
  }

  decode(reader: Reader) {
    return this.rootNode.decodeNode(reader);
  }

  assignPrefixCodes(lines: HuffmanLine[]) {
    // Annex B.3 Assigning the prefix codes.
    const linesLength = lines.length;
    let prefixLengthMax = 0;
    for (let i = 0; i < linesLength; i++) {
      prefixLengthMax = Math.max(prefixLengthMax, lines[i].prefixLength);
    }

    const histogram = new Uint32Array(prefixLengthMax + 1);
    for (let i = 0; i < linesLength; i++) {
      histogram[lines[i].prefixLength]++;
    }
    let currentLength = 1,
      firstCode = 0,
      currentCode,
      currentTemp,
      line;
    histogram[0] = 0;

    while (currentLength <= prefixLengthMax) {
      firstCode = (firstCode + histogram[currentLength - 1]) << 1;
      currentCode = firstCode;
      currentTemp = 0;
      while (currentTemp < linesLength) {
        line = lines[currentTemp];
        if (line.prefixLength === currentLength) {
          line.prefixCode = currentCode;
          currentCode++;
        }
        currentTemp++;
      }
      currentLength++;
    }
  }
}

function decodeTablesSegment(data: Uint8TypedArray, start: number, end: number) {
  // Decodes a Tables segment, i.e., a custom Huffman table.
  // Annex B.2 Code table structure.
  const flags = data[start];
  const lowestValue = readUint32(data, start + 1) & 0xffffffff;
  const highestValue = readUint32(data, start + 5) & 0xffffffff;
  const reader = new Reader(data, start + 9, end);

  const prefixSizeBits = ((flags >> 1) & 7) + 1;
  const rangeSizeBits = ((flags >> 4) & 7) + 1;
  const lines = [];
  let prefixLength,
    rangeLength,
    currentRangeLow = lowestValue;

  // Normal table lines
  do {
    prefixLength = reader.readBits(prefixSizeBits);
    rangeLength = reader.readBits(rangeSizeBits);
    lines.push(
      new HuffmanLine([currentRangeLow, prefixLength, rangeLength, 0])
    );
    currentRangeLow += 1 << rangeLength;
  } while (currentRangeLow < highestValue);

  // Lower range table line
  prefixLength = reader.readBits(prefixSizeBits);
  lines.push(new HuffmanLine([lowestValue - 1, prefixLength, 32, 0, "lower"]));

  // Upper range table line
  prefixLength = reader.readBits(prefixSizeBits);
  lines.push(new HuffmanLine([highestValue, prefixLength, 32, 0]));

  if (flags & 1) {
    // Out-of-band table line
    prefixLength = reader.readBits(prefixSizeBits);
    lines.push(new HuffmanLine([prefixLength, 0]));
  }

  return new HuffmanTable(lines, false);
}

const standardTablesCache: Record<number, HuffmanTable> = {};

function getStandardTable(number: number) {
  // Annex B.5 Standard Huffman tables.
  let table = standardTablesCache[number];
  if (table) {
    return table;
  }
  let lines: (HuffmanLineParamType | HuffmanLine)[];
  switch (number) {
    case 1:
      lines = [
        [0, 1, 4, 0x0],
        [16, 2, 8, 0x2],
        [272, 3, 16, 0x6],
        [65808, 3, 32, 0x7], // upper
      ];
      break;
    case 2:
      lines = [
        [0, 1, 0, 0x0],
        [1, 2, 0, 0x2],
        [2, 3, 0, 0x6],
        [3, 4, 3, 0xe],
        [11, 5, 6, 0x1e],
        [75, 6, 32, 0x3e], // upper
        [6, 0x3f], // OOB
      ];
      break;
    case 3:
      lines = [
        [-256, 8, 8, 0xfe],
        [0, 1, 0, 0x0],
        [1, 2, 0, 0x2],
        [2, 3, 0, 0x6],
        [3, 4, 3, 0xe],
        [11, 5, 6, 0x1e],
        [-257, 8, 32, 0xff, "lower"],
        [75, 7, 32, 0x7e], // upper
        [6, 0x3e], // OOB
      ];
      break;
    case 4:
      lines = [
        [1, 1, 0, 0x0],
        [2, 2, 0, 0x2],
        [3, 3, 0, 0x6],
        [4, 4, 3, 0xe],
        [12, 5, 6, 0x1e],
        [76, 5, 32, 0x1f], // upper
      ];
      break;
    case 5:
      lines = [
        [-255, 7, 8, 0x7e],
        [1, 1, 0, 0x0],
        [2, 2, 0, 0x2],
        [3, 3, 0, 0x6],
        [4, 4, 3, 0xe],
        [12, 5, 6, 0x1e],
        [-256, 7, 32, 0x7f, "lower"],
        [76, 6, 32, 0x3e], // upper
      ];
      break;
    case 6:
      lines = [
        [-2048, 5, 10, 0x1c],
        [-1024, 4, 9, 0x8],
        [-512, 4, 8, 0x9],
        [-256, 4, 7, 0xa],
        [-128, 5, 6, 0x1d],
        [-64, 5, 5, 0x1e],
        [-32, 4, 5, 0xb],
        [0, 2, 7, 0x0],
        [128, 3, 7, 0x2],
        [256, 3, 8, 0x3],
        [512, 4, 9, 0xc],
        [1024, 4, 10, 0xd],
        [-2049, 6, 32, 0x3e, "lower"],
        [2048, 6, 32, 0x3f], // upper
      ];
      break;
    case 7:
      lines = [
        [-1024, 4, 9, 0x8],
        [-512, 3, 8, 0x0],
        [-256, 4, 7, 0x9],
        [-128, 5, 6, 0x1a],
        [-64, 5, 5, 0x1b],
        [-32, 4, 5, 0xa],
        [0, 4, 5, 0xb],
        [32, 5, 5, 0x1c],
        [64, 5, 6, 0x1d],
        [128, 4, 7, 0xc],
        [256, 3, 8, 0x1],
        [512, 3, 9, 0x2],
        [1024, 3, 10, 0x3],
        [-1025, 5, 32, 0x1e, "lower"],
        [2048, 5, 32, 0x1f], // upper
      ];
      break;
    case 8:
      lines = [
        [-15, 8, 3, 0xfc],
        [-7, 9, 1, 0x1fc],
        [-5, 8, 1, 0xfd],
        [-3, 9, 0, 0x1fd],
        [-2, 7, 0, 0x7c],
        [-1, 4, 0, 0xa],
        [0, 2, 1, 0x0],
        [2, 5, 0, 0x1a],
        [3, 6, 0, 0x3a],
        [4, 3, 4, 0x4],
        [20, 6, 1, 0x3b],
        [22, 4, 4, 0xb],
        [38, 4, 5, 0xc],
        [70, 5, 6, 0x1b],
        [134, 5, 7, 0x1c],
        [262, 6, 7, 0x3c],
        [390, 7, 8, 0x7d],
        [646, 6, 10, 0x3d],
        [-16, 9, 32, 0x1fe, "lower"],
        [1670, 9, 32, 0x1ff], // upper
        [2, 0x1], // OOB
      ];
      break;
    case 9:
      lines = [
        [-31, 8, 4, 0xfc],
        [-15, 9, 2, 0x1fc],
        [-11, 8, 2, 0xfd],
        [-7, 9, 1, 0x1fd],
        [-5, 7, 1, 0x7c],
        [-3, 4, 1, 0xa],
        [-1, 3, 1, 0x2],
        [1, 3, 1, 0x3],
        [3, 5, 1, 0x1a],
        [5, 6, 1, 0x3a],
        [7, 3, 5, 0x4],
        [39, 6, 2, 0x3b],
        [43, 4, 5, 0xb],
        [75, 4, 6, 0xc],
        [139, 5, 7, 0x1b],
        [267, 5, 8, 0x1c],
        [523, 6, 8, 0x3c],
        [779, 7, 9, 0x7d],
        [1291, 6, 11, 0x3d],
        [-32, 9, 32, 0x1fe, "lower"],
        [3339, 9, 32, 0x1ff], // upper
        [2, 0x0], // OOB
      ];
      break;
    case 10:
      lines = [
        [-21, 7, 4, 0x7a],
        [-5, 8, 0, 0xfc],
        [-4, 7, 0, 0x7b],
        [-3, 5, 0, 0x18],
        [-2, 2, 2, 0x0],
        [2, 5, 0, 0x19],
        [3, 6, 0, 0x36],
        [4, 7, 0, 0x7c],
        [5, 8, 0, 0xfd],
        [6, 2, 6, 0x1],
        [70, 5, 5, 0x1a],
        [102, 6, 5, 0x37],
        [134, 6, 6, 0x38],
        [198, 6, 7, 0x39],
        [326, 6, 8, 0x3a],
        [582, 6, 9, 0x3b],
        [1094, 6, 10, 0x3c],
        [2118, 7, 11, 0x7d],
        [-22, 8, 32, 0xfe, "lower"],
        [4166, 8, 32, 0xff], // upper
        [2, 0x2], // OOB
      ];
      break;
    case 11:
      lines = [
        [1, 1, 0, 0x0],
        [2, 2, 1, 0x2],
        [4, 4, 0, 0xc],
        [5, 4, 1, 0xd],
        [7, 5, 1, 0x1c],
        [9, 5, 2, 0x1d],
        [13, 6, 2, 0x3c],
        [17, 7, 2, 0x7a],
        [21, 7, 3, 0x7b],
        [29, 7, 4, 0x7c],
        [45, 7, 5, 0x7d],
        [77, 7, 6, 0x7e],
        [141, 7, 32, 0x7f], // upper
      ];
      break;
    case 12:
      lines = [
        [1, 1, 0, 0x0],
        [2, 2, 0, 0x2],
        [3, 3, 1, 0x6],
        [5, 5, 0, 0x1c],
        [6, 5, 1, 0x1d],
        [8, 6, 1, 0x3c],
        [10, 7, 0, 0x7a],
        [11, 7, 1, 0x7b],
        [13, 7, 2, 0x7c],
        [17, 7, 3, 0x7d],
        [25, 7, 4, 0x7e],
        [41, 8, 5, 0xfe],
        [73, 8, 32, 0xff], // upper
      ];
      break;
    case 13:
      lines = [
        [1, 1, 0, 0x0],
        [2, 3, 0, 0x4],
        [3, 4, 0, 0xc],
        [4, 5, 0, 0x1c],
        [5, 4, 1, 0xd],
        [7, 3, 3, 0x5],
        [15, 6, 1, 0x3a],
        [17, 6, 2, 0x3b],
        [21, 6, 3, 0x3c],
        [29, 6, 4, 0x3d],
        [45, 6, 5, 0x3e],
        [77, 7, 6, 0x7e],
        [141, 7, 32, 0x7f], // upper
      ];
      break;
    case 14:
      lines = [
        [-2, 3, 0, 0x4],
        [-1, 3, 0, 0x5],
        [0, 1, 0, 0x0],
        [1, 3, 0, 0x6],
        [2, 3, 0, 0x7],
      ];
      break;
    case 15:
      lines = [
        [-24, 7, 4, 0x7c],
        [-8, 6, 2, 0x3c],
        [-4, 5, 1, 0x1c],
        [-2, 4, 0, 0xc],
        [-1, 3, 0, 0x4],
        [0, 1, 0, 0x0],
        [1, 3, 0, 0x5],
        [2, 4, 0, 0xd],
        [3, 5, 1, 0x1d],
        [5, 6, 2, 0x3d],
        [9, 7, 4, 0x7d],
        [-25, 7, 32, 0x7e, "lower"],
        [25, 7, 32, 0x7f], // upper
      ];
      break;
    default:
      throw new Jbig2Error(`standard table B.${number} does not exist`);
  }

  for (let i = 0, ii = lines.length; i < ii; i++) {
    lines[i] = new HuffmanLine(<HuffmanLineParamType>lines[i]);
  }
  table = new HuffmanTable(<HuffmanLine[]>lines, true);
  standardTablesCache[number] = table;
  return table;
}

class Reader {

  protected shift: number;

  public position: number;

  public start: number;

  public end: number;

  protected currentByte: number;

  protected data: Uint8TypedArray;

  constructor(data: Uint8TypedArray, start: number, end: number) {
    this.data = data;
    this.start = start;
    this.end = end;
    this.position = start;
    this.shift = -1;
    this.currentByte = 0;
  }

  readBit() {
    if (this.shift < 0) {
      if (this.position >= this.end) {
        throw new Jbig2Error("end of data while reading bit");
      }
      this.currentByte = this.data[this.position++];
      this.shift = 7;
    }
    const bit = (this.currentByte >> this.shift) & 1;
    this.shift--;
    return bit;
  }

  readBits(numBits: number) {
    let result = 0,
      i;
    for (i = numBits - 1; i >= 0; i--) {
      result |= this.readBit() << i;
    }
    return result;
  }

  byteAlign() {
    this.shift = -1;
  }

  next() {
    if (this.position >= this.end) {
      return -1;
    }
    return this.data[this.position++];
  }
}

function getCustomHuffmanTable(
  index: number, referredTo: number[],
  customTables: Record<number, HuffmanTable>
) {
  // Returns a Tables segment that has been earlier decoded.
  // See 7.4.2.1.6 (symbol dictionary) or 7.4.3.1.6 (text region).
  let currentIndex = 0;
  for (let i = 0, ii = referredTo.length; i < ii; i++) {
    const table = customTables[referredTo[i]];
    if (table) {
      if (index === currentIndex) {
        return table;
      }
      currentIndex++;
    }
  }
  throw new Jbig2Error("can't find custom Huffman table");
}

function getTextRegionHuffmanTables(
  textRegion: SegmentTextRegion,
  referredTo: number[],
  customTables: Record<number, HuffmanTable>,
  numberOfSymbols: number,
  reader: Reader
) {
  // 7.4.3.1.7 Symbol ID Huffman table decoding

  // Read code lengths for RUNCODEs 0...34.
  const codes = [];
  for (let i = 0; i <= 34; i++) {
    const codeLength = reader.readBits(4);
    codes.push(new HuffmanLine([i, codeLength, 0, 0]));
  }
  // Assign Huffman codes for RUNCODEs.
  const runCodesTable = new HuffmanTable(codes, false);

  // Read a Huffman code using the assignment above.
  // Interpret the RUNCODE codes and the additional bits (if any).
  codes.length = 0;
  for (let i = 0; i < numberOfSymbols;) {
    const codeLength = runCodesTable.decode(reader)!;
    if (codeLength >= 32) {
      let repeatedLength, numberOfRepeats, j;
      switch (codeLength) {
        case 32:
          if (i === 0) {
            throw new Jbig2Error("no previous value in symbol ID table");
          }
          numberOfRepeats = reader.readBits(2) + 3;
          repeatedLength = codes[i - 1].prefixLength;
          break;
        case 33:
          numberOfRepeats = reader.readBits(3) + 3;
          repeatedLength = 0;
          break;
        case 34:
          numberOfRepeats = reader.readBits(7) + 11;
          repeatedLength = 0;
          break;
        default:
          throw new Jbig2Error("invalid code length in symbol ID table");
      }
      for (j = 0; j < numberOfRepeats; j++) {
        codes.push(new HuffmanLine([i, repeatedLength, 0, 0]));
        i++;
      }
    } else {
      codes.push(new HuffmanLine([i, codeLength!, 0, 0]));
      i++;
    }
  }
  reader.byteAlign();
  const symbolIDTable = new HuffmanTable(codes, false);

  // 7.4.3.1.6 Text region segment Huffman table selection

  let customIndex = 0,
    tableFirstS,
    tableDeltaS,
    tableDeltaT;

  switch (textRegion.huffmanFS) {
    case 0:
    case 1:
      tableFirstS = getStandardTable(textRegion.huffmanFS + 6);
      break;
    case 3:
      tableFirstS = getCustomHuffmanTable(
        customIndex,
        referredTo,
        customTables
      );
      customIndex++;
      break;
    default:
      throw new Jbig2Error("invalid Huffman FS selector");
  }

  switch (textRegion.huffmanDS) {
    case 0:
    case 1:
    case 2:
      tableDeltaS = getStandardTable(textRegion.huffmanDS + 8);
      break;
    case 3:
      tableDeltaS = getCustomHuffmanTable(
        customIndex,
        referredTo,
        customTables
      );
      customIndex++;
      break;
    default:
      throw new Jbig2Error("invalid Huffman DS selector");
  }

  switch (textRegion.huffmanDT) {
    case 0:
    case 1:
    case 2:
      tableDeltaT = getStandardTable(textRegion.huffmanDT + 11);
      break;
    case 3:
      tableDeltaT = getCustomHuffmanTable(
        customIndex,
        referredTo,
        customTables
      );
      customIndex++;
      break;
    default:
      throw new Jbig2Error("invalid Huffman DT selector");
  }

  if (textRegion.refinement) {
    // Load tables RDW, RDH, RDX and RDY.
    throw new Jbig2Error("refinement with Huffman is not supported");
  }

  return {
    symbolIDTable,
    tableFirstS,
    tableDeltaS,
    tableDeltaT,
  };
}

function getSymbolDictionaryHuffmanTables(
  dictionary: SegmentDictionary,
  referredTo: number[],
  customTables: Record<number, HuffmanTable>
) {
  // 7.4.2.1.6 Symbol dictionary segment Huffman table selection

  let customIndex = 0,
    tableDeltaHeight,
    tableDeltaWidth;
  switch (dictionary.huffmanDHSelector) {
    case 0:
    case 1:
      tableDeltaHeight = getStandardTable(dictionary.huffmanDHSelector + 4);
      break;
    case 3:
      tableDeltaHeight = getCustomHuffmanTable(
        customIndex,
        referredTo,
        customTables
      );
      customIndex++;
      break;
    default:
      throw new Jbig2Error("invalid Huffman DH selector");
  }

  switch (dictionary.huffmanDWSelector) {
    case 0:
    case 1:
      tableDeltaWidth = getStandardTable(dictionary.huffmanDWSelector + 2);
      break;
    case 3:
      tableDeltaWidth = getCustomHuffmanTable(
        customIndex,
        referredTo,
        customTables
      );
      customIndex++;
      break;
    default:
      throw new Jbig2Error("invalid Huffman DW selector");
  }

  let tableBitmapSize, tableAggregateInstances;
  if (dictionary.bitmapSizeSelector) {
    tableBitmapSize = getCustomHuffmanTable(
      customIndex,
      referredTo,
      customTables
    );
    customIndex++;
  } else {
    tableBitmapSize = getStandardTable(1);
  }

  if (dictionary.aggregationInstancesSelector) {
    tableAggregateInstances = getCustomHuffmanTable(
      customIndex,
      referredTo,
      customTables
    );
  } else {
    tableAggregateInstances = getStandardTable(1);
  }

  return {
    tableDeltaHeight,
    tableDeltaWidth,
    tableBitmapSize,
    tableAggregateInstances,
  };
}

function readUncompressedBitmap(reader: Reader, width: number, height: number) {
  const bitmap = [];
  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(width);
    bitmap.push(row);
    for (let x = 0; x < width; x++) {
      row[x] = reader.readBit();
    }
    reader.byteAlign();
  }
  return bitmap;
}

function decodeMMRBitmap(input: Reader, width: number, height: number, endOfBlock: boolean) {
  // MMR is the same compression algorithm as the PDF filter
  // CCITTFaxDecode with /K -1.
  const params = {
    K: -1,
    Columns: width,
    Rows: height,
    BlackIs1: true,
    EndOfBlock: endOfBlock,
  };
  const decoder = new CCITTFaxDecoder(input, params);
  const bitmap = [];
  let currentByte,
    eof = false;

  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(width);
    bitmap.push(row);
    let shift = -1;
    for (let x = 0; x < width; x++) {
      if (shift < 0) {
        currentByte = decoder.readNextChar();
        if (currentByte === -1) {
          // Set the rest of the bits to zero.
          currentByte = 0;
          eof = true;
        }
        shift = 7;
      }
      row[x] = (currentByte! >> shift) & 1;
      shift--;
    }
  }

  if (endOfBlock && !eof) {
    // Read until EOFB has been consumed.
    const lookForEOFLimit = 5;
    for (let i = 0; i < lookForEOFLimit; i++) {
      if (decoder.readNextChar() === -1) {
        break;
      }
    }
  }

  return bitmap;
}

export class Jbig2Image {

  width: number | null = null;

  height: number | null = null;

  parseChunks(chunks: { data: Uint8TypedArray, start: number, end: number }[]) {
    return parseJbig2Chunks(chunks);
  }

  parse(data: Uint8TypedArray) {
    if (PlatformHelper.hasImageDecoders()) {
      throw new Error("Not implemented: Jbig2Image.parse");
    }
    const { imgData, width, height } = parseJbig2(data);
    this.width = width;
    this.height = height;
    return imgData;
  }
}
