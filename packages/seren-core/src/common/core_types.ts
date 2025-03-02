import { TransformType, Name, Ref, Dict, TextMarkedContent, TextItem, StreamSink, EvaluatorTextContent, FieldObject, CssFontInfo } from "seren-common";

export class TextContentSinkProxy implements StreamSink<EvaluatorTextContent> {

  protected sink: StreamSink<EvaluatorTextContent>;

  public enqueueInvoked = false;

  public onCancel: ((reason: Error) => void) | null = null;

  public onPull: (() => void) | null = null;

  constructor(sink: StreamSink<EvaluatorTextContent>) {
    this.sink = sink;
  }

  get isCancelled() {
    return this.sink.isCancelled;
  }

  set isCancelled(isCancelled: boolean) {
    this.sink.isCancelled = isCancelled;
  }

  get sinkCapability() {
    return this.sink.sinkCapability!;
  };

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

export interface GeneralFieldObject extends FieldObject {
  actions: Map<string, string[]> | null;
  name: string | null;
  strokeColor: Uint8ClampedArray<ArrayBuffer> | null;
  fillColor: Uint8ClampedArray<ArrayBuffer> | null;
  rotation: number;
}

export interface DefaultFieldObject extends GeneralFieldObject {
  kidIds: string[] | null;
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

export function isFullTextContentItem(obj: TextMarkedContent | TextItem): obj is TextItem {
  const record = obj as any;
  return record.str != undefined;
}


