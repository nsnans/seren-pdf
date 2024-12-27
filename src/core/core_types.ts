import { TransformType } from "../display/display_utils";
import { AnnotationEditorSerial } from "../display/editor/state/editor_serializable";
import { MessagePoster, StreamKind, wrapReason } from "../shared/message_handler_base";
import { assert } from "../shared/util";
import { CssFontInfo } from "./evaluator";
import { Dict, Name, Ref } from "./primitives";

export interface ImageMask {
  data: Uint8Array<ArrayBuffer> | null;
  width: number;
  height: number;
  interpolate: number[];
  cached?: boolean;
  dataLen?: number;
  bitmap?: ImageBitmap;
  ref?: string | null;
}

export interface SingleOpaquePixelImageMask {
  isSingleOpaquePixel: boolean;
}

export interface SMaskOptions {
  transferMap?: Uint8Array;
  subtype: string;
  backdrop: number[];
}

export interface StreamGetOperatorListParameters {
  pageIndex: number;
  intent: number;
  cacheKey: string;
  annotationStorage: Map<string, AnnotationEditorSerial> | null;
  modifiedIds: Set<string>;
}

export interface StreamSink<Chunk> {

  ready: Promise<void> | null;

  desiredSize: number;

  enqueue(chunk: Chunk, size: number, transfers?: Transferable[]): void;

  close(): void;

  error(reason: any): void;

  onCancel: ((reason: Error) => void) | null;

  onPull: (() => void) | null;

}

export class TextContentSinkProxy implements StreamSink<EvaluatorTextContent> {

  protected sink: StreamSink<EvaluatorTextContent>;

  public enqueueInvoked = false;

  public onCancel: ((reason: Error) => void) | null = null;

  public onPull: (() => void) | null = null;

  constructor(sink: StreamSink<EvaluatorTextContent>) {
    this.sink = sink;
  }

  get ready() {
    return this.sink.ready;
  }

  get desiredSize() {
    return this.sink.desiredSize;
  }

  enqueue(chunk: EvaluatorTextContent, size: number): void {
    this.enqueueInvoked = true;
    this.sink.enqueue(chunk, size);
  }

  close() { }

  error(_reason: any) { }
  
}

export class GeneralStreamSink<Chunk> implements StreamSink<Chunk> {

  public sinkCapability: PromiseWithResolvers<void>;

  public ready: Promise<void> | null = null;

  public isCancelled: boolean = false;

  public desiredSize: number;

  readonly comObj: MessagePoster;

  readonly sourceName: string;

  readonly targetName: string;

  readonly streamId: number;

  public onPull: (() => void) | null = null;

  public onCancel: ((reason: Error) => void) | null = null;

  readonly onClose: (streamId: number) => void;

  constructor(comObj: MessagePoster, sourceName: string, targetName: string,
    streamId: number, desiredSize: number, onClose: (id: number) => void) {
    this.comObj = comObj;
    this.sinkCapability = Promise.withResolvers();
    this.sourceName = sourceName;
    this.targetName = targetName;
    this.streamId = streamId;
    this.desiredSize = desiredSize;
    this.onClose = onClose;
  }

  enqueue(chunk: Chunk, size = 1, transfers?: Transferable[]) {
    if (this.isCancelled) {
      return;
    }
    const lastDesiredSize = this.desiredSize;
    this.desiredSize -= size;
    // Enqueue decreases the desiredSize property of sink,
    // so when it changes from positive to negative,
    // set ready as unresolved promise.
    if (lastDesiredSize > 0 && this.desiredSize <= 0) {
      this.sinkCapability = Promise.withResolvers();
      this.ready = this.sinkCapability.promise;
    }
    const msg = {
      sourceName: this.sourceName,
      targetName: this.targetName,
      stream: StreamKind.ENQUEUE,
      streamId: this.streamId,
      chunk,
    }
    const post = this.comObj.postMessage;
    // 兼容性写法，主要针对TypeScript报错
    !!transfers ? post(msg, transfers) : post(msg);
  }

  close() {
    if (this.isCancelled) {
      return;
    }
    this.isCancelled = true;
    const msg = {
      sourceName: this.sourceName,
      targetName: this.streamId,
      stream: StreamKind.CLOSE,
      streamId: this.streamId,
    };
    this.comObj.postMessage(msg);
    this.onClose(this.streamId);
  }

  error(reason: Error) {
    assert(reason instanceof Error, "error must have a valid reason");
    if (this.isCancelled) {
      return;
    }
    this.isCancelled = true;
    this.comObj.postMessage({
      sourceName: this.sourceName,
      targetName: this.targetName,
      stream: StreamKind.ERROR,
      streamId: this.streamId,
      reason: wrapReason(reason),
    });
  }
}

export interface FieldObject {
  id: string;
  actions: Record<string, string[]> | null;
  name: string;
  strokeColor: Uint8ClampedArray | null;
  fillColor: Uint8ClampedArray | null;
  type: string;
  kidIds: string[] | null;
  page: number;
  rotation: number;
}

export interface PreEvaluatedFont {
  descriptor: Dict | Ref;
  dict: Dict;
  baseDict: Dict;
  composite: boolean;
  type: string;
  firstChar: number;
  lastChar: number;
  toUnicode: Name;
  hash: string;
  cssFontInfo: CssFontInfo | null;
}

export interface TextContentItem {
  str: string;
  dir: string;
  width: number;
  height: number;
  transform: TransformType | null;
  fontName: string | null;
  hasEOL: boolean;
}

export interface SimpleTextContentItem {
  type: string;
  id?: string | null;
  tag?: string | null;
}

export interface DefaultTextContentItem {
  initialized: boolean;
  str: string[];
  totalWidth: number;
  totalHeight: number;
  width: number;
  height: number;
  vertical: boolean;
  prevTransform: TransformType | null;
  textAdvanceScale: number;
  spaceInFlowMin: number;
  spaceInFlowMax: number;
  trackingSpaceMin: number;
  negativeSpaceMax: number;
  notASpace: number;
  transform: TransformType | null;
  fontName: string | null;
  hasEOL: boolean;
}

export function isFullTextContentItem(obj: SimpleTextContentItem | TextContentItem): obj is TextContentItem {
  const record = obj as any;
  return record.str != undefined;
}

export interface EvaluatorTextContent {
  items: (TextContentItem | SimpleTextContentItem)[];
  styles: Map<string, {
    fontFamily: string,
    ascent: number,
    descent: number,
    vertical: boolean | null,
    fontSubstitution: string | null,
    fontSubstitutionLoadedName: string | null,
  }>;
  lang: string | null;
}
