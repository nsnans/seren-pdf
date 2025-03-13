/* Copyright 2021 Mozilla Foundation
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

import { BaseStream } from "../stream/base_stream";
import {
  MissingDataException,
  ParserEOFException,
  XRefEntryException,
  XRefParseException,
} from "../utils/core_utils";
import { CipherTransformFactory } from "../crypto/crypto";
import { Lexer, Parser } from "../parser/parser";
import { assertNotNull, DataStream, FetchResultType, ParsedEntry, ParsedType } from "seren-common";
import { PDFManager } from "../worker/pdf_manager";
import {
  CIRCULAR_REF,
  Cmd,
  DictKey,
  isCmd,
  Ref,
  RefSet,
  Dict,
  warn,
  XRef,
  PlatformHelper,
  assert,
  FormatError,
  InvalidPDFException,
  Uint8TypedArray,
  bytesToString,
  info,
  Name
} from "seren-common";
import { Stream } from "../stream/stream";
import { DictImpl } from "./dict_impl";
import { isNull } from 'seren-common';


interface StreamState {

  entryRanges: [number, number];

  byteWidths: [number, number, number];

  entryNum: number;

  streamPos: number;
}

interface TableState {
  entryNum: number;
  streamPos: number;
  parserBuf1: ParsedType;
  parserBuf2: ParsedType;
  entryCount: number | null;
  firstEntryNum: number | null;
};

export class XRefImpl implements XRef {

  protected _firstXRefStmPos: number | null = null;

  public stream: Stream;

  protected pdfManager: PDFManager;

  protected _xrefStms = new Set<number>();

  protected _cacheMap = new Map<number, string | number | boolean | Dict | Ref | Name | Cmd | Symbol | ParsedType[] | DataStream | null>();

  protected _pendingRefs = new RefSet();

  protected _newPersistentRefNum: number | null;

  protected _newTemporaryRefNum: number | null;

  protected _persistentRefsCache: Map<number, string | number | boolean | Ref | Name | Dict | Cmd | Symbol | ParsedType[] | DataStream | null> | null;

  protected entries: ParsedEntry[];

  protected root: Dict | null;

  public trailer: Dict | null

  public topDict: Dict | null;

  protected startXRefQueue: number[] = [];

  protected _generationFallback: boolean | null;

  public encrypt: CipherTransformFactory | null;

  protected streamState: StreamState | null = null;

  protected tableState: TableState | null = null;

  constructor(stream: Stream, pdfManager: PDFManager) {
    this.stream = stream;
    this.pdfManager = pdfManager;
    this.entries = [];
    this._xrefStms = new Set();
    this._cacheMap = new Map(); // Prepare the XRef cache.
    this._pendingRefs = new RefSet();
    this._newPersistentRefNum = null;
    this._newTemporaryRefNum = null;
    this._persistentRefsCache = null;

    this.root = null;
    this.trailer = null;
    this.topDict = null;
    this._generationFallback = null;
    this.encrypt = null;
  }

  getNewPersistentRef(obj: Dict) {
    // When printing we don't care that much about the ref number by itself, it
    // can increase for ever and it allows to keep some re-usable refs.
    if (this._newPersistentRefNum === null) {
      this._newPersistentRefNum = this.entries.length || 1;
    }
    const num = this._newPersistentRefNum++;
    this._cacheMap.set(num, obj);
    return Ref.get(num, 0);
  }

  getNewTemporaryRef() {
    // When saving we want to have some minimal numbers.
    // Those refs are only created in order to be written in the final pdf
    // stream.
    if (this._newTemporaryRefNum === null) {
      this._newTemporaryRefNum = this.entries.length || 1;
      if (this._newPersistentRefNum) {
        this._persistentRefsCache = new Map();
        for (
          let i = this._newTemporaryRefNum;
          i < this._newPersistentRefNum;
          i++
        ) {
          // We *temporarily* clear the cache, see `resetNewTemporaryRef` below,
          // to avoid any conflict with the refs created during saving.
          this._persistentRefsCache.set(i, this._cacheMap.get(i)!);
          this._cacheMap.delete(i);
        }
      }
    }
    return Ref.get(this._newTemporaryRefNum++, 0);
  }

  resetNewTemporaryRef(): void {
    // Called once saving is finished.
    this._newTemporaryRefNum = null;
    if (this._persistentRefsCache) {
      for (const [num, obj] of this._persistentRefsCache) {
        this._cacheMap.set(num, obj);
      }
    }
    this._persistentRefsCache = null;
  }

  setStartXRef(startXRef: number) {
    // Store the starting positions of xref tables as we process them
    // so we can recover from missing data errors
    this.startXRefQueue = [startXRef];
  }

  parse(recoveryMode = false) {
    let trailerDict: Dict | null;
    if (!recoveryMode) {
      trailerDict = this.readXRef();
    } else {
      warn("Indexing all PDF objects");
      trailerDict = this.indexObjects();
    }
    assertNotNull(trailerDict);
    trailerDict.assignXref(this);
    this.trailer = trailerDict;

    let encrypt;
    try {
      encrypt = trailerDict.getValue(DictKey.Encrypt);
    } catch (ex) {
      if (ex instanceof MissingDataException) {
        throw ex;
      }
      warn(`XRef.parse - Invalid "Encrypt" reference: "${ex}".`);
    }
    if (encrypt instanceof DictImpl) {
      const ids = trailerDict.getValue(DictKey.ID);
      const fileId = ids?.length ? ids[0] : "";
      // The 'Encrypt' dictionary itself should not be encrypted, and by
      // setting `suppressEncryption` we can prevent an infinite loop inside
      // of `XRef_fetchUncompressed` if the dictionary contains indirect
      // objects (fixes issue7665.pdf).
      encrypt.suppressEncryption = true;
      this.encrypt = new CipherTransformFactory(
        encrypt,
        fileId,
        this.pdfManager.password
      );
    }

    // Get the root dictionary (catalog) object, and do some basic validation.
    let root;
    try {
      root = trailerDict.getValue(DictKey.Root);
    } catch (ex) {
      if (ex instanceof MissingDataException) {
        throw ex;
      }
      warn(`XRef.parse - Invalid "Root" reference: "${ex}".`);
    }
    if (root instanceof DictImpl) {
      try {
        const pages = root.getValue(DictKey.Pages);
        if (pages instanceof DictImpl) {
          this.root = root;
          return;
        }
      } catch (ex) {
        if (ex instanceof MissingDataException) {
          throw ex;
        }
        warn(`XRef.parse - Invalid "Pages" reference: "${ex}".`);
      }
    }

    if (!recoveryMode) {
      throw new XRefParseException();
    }
    // Even recovery failed, there's nothing more we can do here.
    throw new InvalidPDFException("Invalid Root reference.");
  }

  processXRefTable(parser: Parser) {
    if (this.tableState === null) {
      // Stores state of the table as we process it so we can resume
      // from middle of table in case of missing data error
      this.tableState = {
        entryNum: 0,
        streamPos: parser.lexer.stream.pos,
        parserBuf1: parser.buf1,
        parserBuf2: parser.buf2,
        entryCount: null,
        firstEntryNum: null,
      };
    }

    const obj = this.readXRefTable(parser);

    // Sanity check
    if (!isCmd(obj, "trailer")) {
      throw new FormatError(
        "Invalid XRef table: could not find trailer dictionary"
      );
    }
    // Read trailer dictionary, e.g.
    // trailer
    //    << /Size 22
    //      /Root 20R
    //      /Info 10R
    //      /ID [ <81b14aafa313db63dbd6f981e49f94f4> ]
    //    >>
    // The parser goes through the entire stream << ... >> and provides
    // a getter interface for the key-value table
    let dict = parser.getObj();

    // The pdflib PDF generator can generate a nested trailer dictionary
    if (!(dict instanceof DictImpl) && (<{ dict?: Dict }>dict)!.dict) {
      dict = (<{ dict?: Dict }>dict)!.dict!;
    }
    if (!(dict instanceof DictImpl)) {
      throw new FormatError(
        "Invalid XRef table: could not parse trailer dictionary"
      );
    }
    this.tableState = null;
    return dict;
  }

  readXRefTable(parser: Parser) {
    // Example of cross-reference table:
    // xref
    // 0 1                    <-- subsection header (first obj #, obj count)
    // 0000000000 65535 f     <-- actual object (offset, generation #, f/n)
    // 23 2                   <-- subsection header ... and so on ...
    // 0000025518 00002 n
    // 0000025635 00000 n
    // trailer
    // ...

    const stream = parser.lexer.stream;
    const tableState = this.tableState!;
    stream.pos = tableState.streamPos;
    parser.buf1 = tableState.parserBuf1;
    parser.buf2 = tableState.parserBuf2;

    // Outer loop is over subsection headers
    let obj;

    while (true) {
      if (tableState.firstEntryNum == null || tableState.entryCount == null) {
        if (isCmd((obj = parser.getObj()), "trailer")) {
          break;
        }
        tableState.firstEntryNum = <number>obj;
        tableState.entryCount = <number>parser.getObj();
      }

      let first = tableState.firstEntryNum!;
      const count = tableState.entryCount!;
      if (!Number.isInteger(first) || !Number.isInteger(count)) {
        throw new FormatError(
          "Invalid XRef table: wrong types in subsection header"
        );
      }
      // Inner loop is over objects themselves
      for (let i = tableState.entryNum; i < count; i++) {
        tableState.streamPos = stream.pos;
        tableState.entryNum = i;
        tableState.parserBuf1 = parser.buf1;
        tableState.parserBuf2 = parser.buf2;

        const entry: ParsedEntry = {
          offset: 0,
          gen: 0,
          free: false,
          uncompressed: false
        };
        entry.offset = <number>parser.getObj();
        entry.gen = <number>parser.getObj();
        const type = parser.getObj();

        if (type instanceof Cmd) {
          switch (type.cmd) {
            case "f":
              entry.free = true;
              break;
            case "n":
              entry.uncompressed = true;
              break;
          }
        }

        // Validate entry obj
        if (
          !Number.isInteger(entry.offset) ||
          !Number.isInteger(entry.gen) ||
          !(entry.free || entry.uncompressed)
        ) {
          throw new FormatError(
            `Invalid entry in XRef subsection: ${first}, ${count}`
          );
        }

        // The first xref table entry, i.e. obj 0, should be free. Attempting
        // to adjust an incorrect first obj # (fixes issue 3248 and 7229).
        if (i === 0 && entry.free && first === 1) {
          first = 0;
        }

        if (!this.entries[i + first]) {
          this.entries[i + first] = entry;
        }
      }

      tableState.entryNum = 0;
      tableState.streamPos = stream.pos;
      tableState.parserBuf1 = parser.buf1;
      tableState.parserBuf2 = parser.buf2;
      tableState.firstEntryNum = null;
      tableState.entryCount = null;
    }

    // Sanity check: as per spec, first object must be free
    if (this.entries[0] && !this.entries[0].free) {
      throw new FormatError("Invalid XRef table: unexpected first object");
    }
    return obj;
  }

  processXRefStream(stream: BaseStream) {
    // 动态定义字段，或许是为了防止Object.keys影响？
    if (this.streamState === null) {
      // Stores state of the stream as we process it so we can resume
      // from middle of stream in case of missing data error
      const streamParameters = stream.dict;
      const byteWidths = streamParameters!.getValue(DictKey.W);
      let range = streamParameters!.getValue(DictKey.Index);
      if (!range) {
        range = [0, <number>streamParameters!.getValue(DictKey.Size)];
      }

      this.streamState = {
        entryRanges: <[number, number]>range,
        byteWidths: <[number, number, number]>byteWidths,
        entryNum: 0,
        streamPos: stream.pos,
      };
    }
    this.readXRefStream(stream);
    this.streamState = null;

    return stream.dict;
  }

  readXRefStream(stream: BaseStream) {
    const streamState = this.streamState!;
    stream.pos = streamState.streamPos;

    const [typeFieldWidth, offsetFieldWidth, generationFieldWidth] =
      streamState.byteWidths;

    const entryRanges = streamState.entryRanges;
    while (entryRanges.length > 0) {
      const [first, n] = entryRanges;

      if (!Number.isInteger(first) || !Number.isInteger(n)) {
        throw new FormatError(`Invalid XRef range fields: ${first}, ${n}`);
      }
      if (
        !Number.isInteger(typeFieldWidth) ||
        !Number.isInteger(offsetFieldWidth) ||
        !Number.isInteger(generationFieldWidth)
      ) {
        throw new FormatError(
          `Invalid XRef entry fields length: ${first}, ${n}`
        );
      }
      for (let i = streamState.entryNum; i < n; ++i) {
        streamState.entryNum = i;
        streamState.streamPos = stream.pos;

        let type = 0,
          offset = 0,
          generation = 0;
        for (let j = 0; j < typeFieldWidth; ++j) {
          const typeByte = stream.getByte();
          if (typeByte === -1) {
            throw new FormatError("Invalid XRef byteWidths 'type'.");
          }
          type = (type << 8) | typeByte;
        }
        // if type field is absent, its default value is 1
        if (typeFieldWidth === 0) {
          type = 1;
        }
        for (let j = 0; j < offsetFieldWidth; ++j) {
          const offsetByte = stream.getByte();
          if (offsetByte === -1) {
            throw new FormatError("Invalid XRef byteWidths 'offset'.");
          }
          offset = (offset << 8) | offsetByte;
        }
        for (let j = 0; j < generationFieldWidth; ++j) {
          const generationByte = stream.getByte();
          if (generationByte === -1) {
            throw new FormatError("Invalid XRef byteWidths 'generation'.");
          }
          generation = (generation << 8) | generationByte;
        }
        const entry: ParsedEntry = {
          offset: 0,
          gen: 0,
          free: false,
          uncompressed: false
        };
        entry.offset = offset;
        entry.gen = generation;
        switch (type) {
          case 0:
            entry.free = true;
            break;
          case 1:
            entry.uncompressed = true;
            break;
          case 2:
            break;
          default:
            throw new FormatError(`Invalid XRef entry type: ${type}`);
        }
        if (!this.entries[first + i]) {
          this.entries[first + i] = entry;
        }
      }

      streamState.entryNum = 0;
      streamState.streamPos = stream.pos;
      entryRanges.splice(0, 2);
    }
  }

  indexObjects() {

    // Simple scan through the PDF content to find objects,
    // trailers and XRef streams.
    const TAB = 0x9, LF = 0xa, CR = 0xd, SPACE = 0x20;
    const PERCENT = 0x25, LT = 0x3c;

    function readToken(data: Uint8TypedArray, offset: number) {
      let token = "";
      let ch = data[offset];
      while (ch !== LF && ch !== CR && ch !== LT) {
        if (++offset >= data.length) {
          break;
        }
        token += String.fromCharCode(ch);
        ch = data[offset];
      }
      return token;
    }
    function skipUntil(data: Uint8TypedArray, offset: number, what: Uint8Array) {
      const length = what.length;
      const dataLength = data.length;
      let skipped = 0;
      // finding byte sequence
      while (offset < dataLength) {
        let i = 0;
        while (i < length && data[offset + i] === what[i]) {
          ++i;
        }
        if (i >= length) {
          break; // sequence found
        }
        offset++;
        skipped++;
      }
      return skipped;
    }
    const gEndobjRegExp = /\b(endobj|\d+\s+\d+\s+obj|xref|trailer\s*<<)\b/g;
    const gStartxrefRegExp = /\b(startxref|\d+\s+\d+\s+obj)\b/g;
    const objRegExp = /^(\d+)\s+(\d+)\s+obj\b/;

    const trailerBytes = new Uint8Array([116, 114, 97, 105, 108, 101, 114]);
    const startxrefBytes = new Uint8Array([
      115, 116, 97, 114, 116, 120, 114, 101, 102,
    ]);
    const xrefBytes = new Uint8Array([47, 88, 82, 101, 102]);

    // Clear out any existing entries, since they may be bogus.
    this.entries.length = 0;
    this._cacheMap.clear();

    const stream = this.stream;
    stream.pos = 0;
    const buffer = stream.getBytes();
    const bufferStr = bytesToString(buffer);
    const length = buffer.length;
    let position = stream.start;
    const trailers = [];
    const xrefStms = [];
    while (position < length) {
      let ch = buffer[position];
      if (ch === TAB || ch === LF || ch === CR || ch === SPACE) {
        ++position;
        continue;
      }
      if (ch === PERCENT) {
        // %-comment
        do {
          ++position;
          if (position >= length) {
            break;
          }
          ch = buffer[position];
        } while (ch !== LF && ch !== CR);
        continue;
      }
      const token = readToken(buffer, position);
      let m: RegExpExecArray | null = null;
      if (
        token.startsWith("xref") &&
        (token.length === 4 || /\s/.test(token[4]))
      ) {
        position += skipUntil(buffer, position, trailerBytes);
        trailers.push(position);
        position += skipUntil(buffer, position, startxrefBytes);
      } else if ((m = objRegExp.exec(token))) {
        if (!Number.isInteger(parseFloat(m[1])) || !Number.isInteger(parseFloat(m[2]))) {
          throw new Error("这里如果出现了非整数数字，直接抛异常，防止后续运算出现错误")
        }
        const num = parseInt(m[1]) | 0, gen = parseInt(m[2]) | 0;

        const startPos = position + token.length;
        let contentLength,
          updateEntries = false;
        if (!this.entries[num]) {
          updateEntries = true;
        } else if (this.entries[num].gen === gen) {
          // Before overwriting an existing entry, ensure that the new one won't
          // cause *immediate* errors when it's accessed (fixes issue13783.pdf).
          try {
            const parser = new Parser(new Lexer(stream.makeSubStream(startPos)));
            parser.getObj();
            updateEntries = true;
          } catch (ex) {
            if (ex instanceof ParserEOFException) {
              warn(`indexObjects -- checking object (${token}): "${ex}".`);
            } else {
              // The error may come from the `Parser`-instance being initialized
              // without an `XRef`-instance (we don't have a usable one yet).
              updateEntries = true;
            }
          }
        }
        if (updateEntries) {
          this.entries[num] = {
            offset: position - stream.start,
            gen,
            uncompressed: true,
            free: false
          };
        }

        // Find the next "obj" string, rather than "endobj", to ensure that
        // we won't skip over a new 'obj' operator in corrupt files where
        // 'endobj' operators are missing (fixes issue9105_reduced.pdf).
        gEndobjRegExp.lastIndex = startPos;
        const match = gEndobjRegExp.exec(bufferStr);

        if (match) {
          const endPos = gEndobjRegExp.lastIndex + 1;
          contentLength = endPos - position;

          if (match[1] !== "endobj") {
            warn(
              `indexObjects: Found "${match[1]}" inside of another "obj", ` +
              'caused by missing "endobj" -- trying to recover.'
            );
            contentLength -= match[1].length + 1;
          }
        } else {
          contentLength = length - position;
        }
        const content = buffer.subarray(position, position + contentLength);

        // checking XRef stream suspect
        // (it shall have '/XRef' and next char is not a letter)
        const xrefTagOffset = skipUntil(content, 0, xrefBytes);
        if (xrefTagOffset < contentLength && content[xrefTagOffset + 5] < 64) {
          xrefStms.push(position - stream.start);
          this._xrefStms.add(position - stream.start); // Avoid recursion
        }

        position += contentLength;
      } else if (
        token.startsWith("trailer") &&
        (token.length === 7 || /\s/.test(token[7]))
      ) {
        trailers.push(position);

        const startPos = position + token.length;
        let contentLength;
        // Attempt to handle (some) corrupt documents, where no 'startxref'
        // operators are present (fixes issue15590.pdf).
        gStartxrefRegExp.lastIndex = startPos;
        const match = gStartxrefRegExp.exec(bufferStr);

        if (match) {
          const endPos = gStartxrefRegExp.lastIndex + 1;
          contentLength = endPos - position;

          if (match[1] !== "startxref") {
            warn(
              `indexObjects: Found "${match[1]}" after "trailer", ` +
              'caused by missing "startxref" -- trying to recover.'
            );
            contentLength -= match[1].length + 1;
          }
        } else {
          contentLength = length - position;
        }
        position += contentLength;
      } else {
        position += token.length + 1;
      }
    }
    // reading XRef streams
    for (const xrefStm of xrefStms) {
      this.startXRefQueue.push(xrefStm);
      this.readXRef(/* recoveryMode */ true);
    }

    const trailerDicts = [];
    // Pre-parsing the trailers to check if the document is possibly encrypted.
    let isEncrypted = false;
    for (const trailer of trailers) {
      stream.pos = trailer;
      const parser = new Parser(new Lexer(stream), this, true, true);
      const obj = parser.getObj();
      if (!isCmd(obj, "trailer")) {
        continue;
      }
      // read the trailer dictionary
      const dict = parser.getObj();
      if (!(dict instanceof DictImpl)) {
        continue;
      }
      trailerDicts.push(dict);

      if (dict.has(DictKey.Encrypt)) {
        isEncrypted = true;
      }
    }

    // finding main trailer
    // genFallback用来做头尾部字典的分隔词，大部分情况下是Dict类型
    // 在处理的时候需要特殊处理一下
    let trailerDict, trailerError;
    for (const iterVal of [...trailerDicts, "genFallback", ...trailerDicts]) {
      if (iterVal === "genFallback") {
        if (!trailerError) {
          break; // No need to fallback if there were no validation errors.
        }
        this._generationFallback = true;
        continue;
      }

      const dict = <Dict>iterVal;

      // Do some basic validation of the trailer/root dictionary candidate.
      let validPagesDict = false;
      try {
        const rootDict = dict.getValue(DictKey.Root);
        if (!(rootDict instanceof DictImpl)) {
          continue;
        }
        const pagesDict = rootDict.getValue(DictKey.Pages);
        if (!(pagesDict instanceof DictImpl)) {
          continue;
        }
        const pagesCount = pagesDict.getValue(DictKey.Count);
        if (Number.isInteger(pagesCount)) {
          validPagesDict = true;
        }
        // The top-level /Pages dictionary isn't obviously corrupt.
      } catch (ex) {
        trailerError = ex;
        continue;
      }
      // taking the first one with 'ID'
      if (
        validPagesDict &&
        (!isEncrypted || dict.has(DictKey.Encrypt)) &&
        dict.has(DictKey.ID)
      ) {
        return dict;
      }
      // The current dictionary is a candidate, but continue searching.
      trailerDict = dict;
    }
    // No trailer with 'ID', taking last one (if exists).
    if (trailerDict) {
      return trailerDict;
    }
    // No trailer dictionary found, taking the "top"-dictionary (if exists).
    if (this.topDict) {
      return this.topDict;
    }
    // nothing helps
    throw new InvalidPDFException("Invalid PDF structure.");
  }

  readXRef(recoveryMode = false) {
    const stream = this.stream;
    // Keep track of already parsed XRef tables, to prevent an infinite loop
    // when parsing corrupt PDF files where e.g. the /Prev entries create a
    // circular dependency between tables (fixes bug1393476.pdf).
    const startXRefParsedCache = new Set();

    while (this.startXRefQueue.length) {
      try {
        const startXRef = this.startXRefQueue[0];

        if (startXRefParsedCache.has(startXRef)) {
          warn("readXRef - skipping XRef table since it was already parsed.");
          this.startXRefQueue.shift();
          continue;
        }
        startXRefParsedCache.add(startXRef);

        stream.pos = startXRef + stream.start;

        const parser = new Parser(new Lexer(stream), this, true);
        let obj = parser.getObj();
        let dict;

        // Get dictionary
        if (isCmd(obj, "xref")) {
          // Parse end-of-file XRef
          dict = this.processXRefTable(parser);
          if (!this.topDict) {
            this.topDict = dict;
          }

          // Recursively get other XRefs 'XRefStm', if any
          obj = dict.getValue(DictKey.XRefStm);
          if (Number.isInteger(obj) && !this._xrefStms.has(obj)) {
            // ignore previously loaded xref streams
            // (possible infinite recursion)
            this._xrefStms.add(obj);
            this.startXRefQueue.push(obj);
            this._firstXRefStmPos ??= obj;
          }
        } else if (Number.isInteger(obj)) {
          // Parse in-stream XRef
          if (
            !Number.isInteger(parser.getObj()) ||
            !isCmd(parser.getObj(), "obj") ||
            !((obj = parser.getObj()) instanceof BaseStream)
          ) {
            throw new FormatError("Invalid XRef stream");
          }
          dict = this.processXRefStream(obj);
          if (!this.topDict) {
            this.topDict = dict;
          }
          if (!dict) {
            throw new FormatError("Failed to read XRef stream");
          }
        } else {
          throw new FormatError("Invalid XRef stream header");
        }

        // Recursively get previous dictionary, if any
        obj = dict.getValue(DictKey.Prev);
        if (Number.isInteger(obj)) {
          this.startXRefQueue.push(<number>obj);
        } else if (<Ref | unknown>obj instanceof Ref) {
          // The spec says Prev must not be a reference, i.e. "/Prev NNN"
          // This is a fallback for non-compliant PDFs, i.e. "/Prev NNN 0 R"
          this.startXRefQueue.push((<Ref>obj).num);
        }
      } catch (e) {
        if (e instanceof MissingDataException) {
          throw e;
        }
        info("(while reading XRef): " + e);
      }
      this.startXRefQueue.shift();
    }

    if (this.topDict) {
      return this.topDict;
    }
    if (recoveryMode) {
      return null;
    }
    throw new XRefParseException();
  }

  get lastXRefStreamPos() {
    return (
      this._firstXRefStmPos ??
      (this._xrefStms.size > 0 ? Math.max(...this._xrefStms) : null)
    );
  }

  getEntry(i: number) {
    const xrefEntry = this.entries[i];
    if (xrefEntry && !xrefEntry.free && xrefEntry.offset) {
      return xrefEntry;
    }
    return null;
  }

  fetchIfRef(obj: Ref | number | string | object, suppressEncryption = false) {
    if (obj instanceof Ref) {
      return this.fetch(obj, suppressEncryption);
    }
    return obj;
  }

  // 应该要改成泛型，但是至于Ref怎么改，还需要进一步处理
  fetch(ref: Ref, suppressEncryption = false) {
    if (!(ref instanceof Ref)) {
      throw new Error("ref object is not a reference");
    }
    const num = ref.num;

    // The XRef cache is populated with objects which are obtained through
    // `Parser.getObj`, and indirectly via `Lexer.getObj`. Neither of these
    // methods should ever return `undefined` (note the `assert` calls below).
    const cacheEntry = this._cacheMap.get(num);
    if (cacheEntry !== undefined) {
      // In documents with Object Streams, it's possible that cached `Dict`s
      // have not been assigned an `objId` yet (see e.g. issue3115r.pdf).
      if (cacheEntry instanceof DictImpl && !cacheEntry.objId) {
        cacheEntry.objId = ref.toString();
      }
      return cacheEntry;
    }

    let xrefEntry = this.getEntry(num);

    if (xrefEntry === null) {
      // The referenced entry can be free.
      this._cacheMap.set(num, xrefEntry);
      return xrefEntry;
    }

    // Prevent circular references, in corrupt PDF documents, from hanging the
    // worker-thread. This relies, implicitly, on the parsing being synchronous.
    if (this._pendingRefs.has(ref)) {
      this._pendingRefs.remove(ref);

      warn(`Ignoring circular reference: ${ref}.`);
      return CIRCULAR_REF;
    }
    this._pendingRefs.put(ref);

    let parsedXrefEntry: ParsedEntry | ParsedType | ParsedType[];

    try {
      parsedXrefEntry = xrefEntry.uncompressed ? this.fetchUncompressed(ref, xrefEntry!, suppressEncryption)
        : this.fetchCompressed(ref, xrefEntry!, suppressEncryption);
      this._pendingRefs.remove(ref);
    } catch (ex) {
      this._pendingRefs.remove(ref);
      throw ex;
    }
    if (parsedXrefEntry instanceof DictImpl) {
      parsedXrefEntry.objId = ref.toString();
    } else if (parsedXrefEntry instanceof BaseStream) {
      parsedXrefEntry.dict!.objId = ref.toString();
    }
    return parsedXrefEntry;
  }

  fetchUncompressed(ref: Ref, xrefEntry: ParsedEntry, suppressEncryption = false): ParsedType | ParsedType[] {
    const gen = ref.gen;
    let num = ref.num;
    if (xrefEntry.gen !== gen) {
      const msg = `Inconsistent generation in XRef: ${ref}`;
      // Try falling back to a *previous* generation (fixes issue15577.pdf).
      if (this._generationFallback && xrefEntry.gen < gen) {
        warn(msg);
        return this.fetchUncompressed(
          Ref.get(num, xrefEntry.gen), xrefEntry, suppressEncryption
        );
      }
      throw new XRefEntryException(msg);
    }
    const stream = this.stream.makeSubStream(
      xrefEntry.offset + this.stream.start
    );
    const parser = new Parser(new Lexer(stream), this, true);
    const obj1 = parser.getObj();
    const obj2 = parser.getObj();
    const obj3 = parser.getObj();

    if (obj1 !== num || obj2 !== gen || !(obj3 instanceof Cmd)) {
      throw new XRefEntryException(`Bad (uncompressed) XRef entry: ${ref}`);
    }
    if (obj3.cmd !== "obj") {
      // some bad PDFs use "obj1234" and really mean 1234
      if (obj3.cmd.startsWith("obj")) {
        num = parseInt(obj3.cmd.substring(3), 10);
        if (!Number.isNaN(num)) {
          return num;
        }
      }
      throw new XRefEntryException(`Bad (uncompressed) XRef entry: ${ref}`);
    }
    const parsedXrefEntry = this.encrypt && !suppressEncryption
      ? parser.getObj(this.encrypt.createCipherTransform(num, gen))
      : parser.getObj();
    if (!(parsedXrefEntry instanceof BaseStream)) {
      if (!PlatformHelper.hasDefined() || PlatformHelper.isTesting()) {
        assert(parsedXrefEntry !== undefined, 'fetchUncompressed: The "xrefEntry" cannot be undefined.');
      }
      this._cacheMap.set(num, parsedXrefEntry);
    }
    return parsedXrefEntry;
  }

  fetchCompressed(ref: Ref, xrefEntry: ParsedEntry, _suppressEncryption = false) {
    const tableOffset = xrefEntry.offset;
    const stream = this.fetch(Ref.get(tableOffset, 0));
    if (!(stream instanceof BaseStream)) {
      throw new FormatError("bad ObjStm stream");
    }
    const first = stream.dict!.getValue(DictKey.First);
    const n = <number>stream.dict!.getValue(DictKey.N);
    if (!Number.isInteger(first) || !Number.isInteger(n)) {
      throw new FormatError("invalid first and n parameters for ObjStm stream");
    }
    let parser = new Parser(new Lexer(stream), this, true);
    const nums = new Array(n);
    const offsets = new Array(n);
    // read the object numbers to populate cache
    for (let i = 0; i < n; ++i) {
      const num = parser.getObj();
      if (!Number.isInteger(num)) {
        throw new FormatError(
          `invalid object number in the ObjStm stream: ${num}`
        );
      }
      const offset = parser.getObj();
      if (!Number.isInteger(offset)) {
        throw new FormatError(
          `invalid object offset in the ObjStm stream: ${offset}`
        );
      }
      nums[i] = num;
      offsets[i] = offset;
    }

    const start = (stream.start || 0) + <number>first;
    const entries = new Array(n);
    // read stream objects for cache
    for (let i = 0; i < n; ++i) {
      const length = i < n - 1 ? offsets[i + 1] - offsets[i] : undefined;
      if (length! < 0) {
        throw new FormatError("Invalid offset in the ObjStm stream.");
      }
      const lexer = new Lexer(<Stream>stream.makeSubStream(start + offsets[i], length!, stream.dict));
      parser = new Parser(lexer, this, true);

      const obj = parser.getObj();
      entries[i] = obj;
      if (obj instanceof BaseStream) {
        continue;
      }
      const num = nums[i],
        entry = this.entries[num];
      if (entry && entry.offset === tableOffset && entry.gen === i) {
        if (!PlatformHelper.hasDefined() || PlatformHelper.isTesting()) {
          assert(
            obj !== undefined,
            'fetchCompressed: The "obj" cannot be undefined.'
          );
        }
        this._cacheMap.set(num, obj);
      }
    }
    xrefEntry = entries[xrefEntry.gen];
    if (isNull(xrefEntry)) {
      throw new XRefEntryException(`Bad (compressed) XRef entry: ${ref}`);
    }
    return xrefEntry;
  }

  async fetchIfRefAsync<T>(obj: Ref | T, suppressEncryption = false) {
    if (obj instanceof Ref) {
      return this.fetchAsync(obj, suppressEncryption);
    }
    return obj;
  }

  async fetchAsync(ref: Ref, suppressEncryption?: boolean): Promise<FetchResultType> {
    try {
      return this.fetch(ref, suppressEncryption);
    } catch (ex) {
      if (!(ex instanceof MissingDataException)) {
        throw ex;
      }
      await this.pdfManager.requestRange(ex.begin, ex.end);
      return this.fetchAsync(ref, suppressEncryption);
    }
  }

  getCatalogObj() {
    return this.root;
  }
}
