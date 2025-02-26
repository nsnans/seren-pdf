
import { PDFMetadataInfo } from "../types/document_types";
import { Uint8TypedArray } from "../common/typed_array";
import { GetAnnotationsMessage, FieldObject, AnnotationEditorSerial, AnnotationData } from "../types/annotation_types";
import { ViewerPreferenceKeys, CatalogOpenAction, CatalogMarkInfo, CatalogOutlineItem, CatalogOptionalContentConfig } from "../types/catalog_types";
import { DocumentParameter, StructTreeSerialNode, PDFDocumentInfo } from "../types/document_types";
import { EvaluatorTextContent } from "../types/evaluator_types";
import { GetDocMessage, StartRenderPageMessage, OnProgressParameters, FetchBuiltInCMapMessage, PageInfo, FileSpecSerializable, ObjType, ObjDataType, CommonObjType, CommonObjDataType, GetTextContentMessage, SaveDocumentMessage } from "../types/message_handler_types";
import { OpertaorListChunk, StreamGetOperatorListParameters } from "../types/operator_types";
import { StreamSink, ReaderHeadersReadyResult } from "../types/stream_types";
import { PasswordException, BaseException } from "../utils/util";
import { DestinationType } from "../common/common_types";


export interface MessageHandler {

  GetDocRequest(docParams: DocumentParameter, data: ArrayBuffer[] | null): Promise<string>;

  onGetDocRequest(fn: (param: DocumentParameter) => string): void;

  test(data: Uint8Array<ArrayBuffer> | boolean, transfers: Transferable[] | null): void;

  onTest(fn: (data: Uint8Array<ArrayBuffer> | boolean, transfers: Transferable[] | null) => void): void;

  configure(verbosity: number): void;

  onConfigure(fn: (verbosity: { verbosity: number }) => void): void;

  GetReader(): ReadableStream<Uint8Array<ArrayBuffer>>;

  onGetReader(fn: (data: null, sink: StreamSink<Uint8Array<ArrayBuffer>>) => void): void;

  GetRangeReader(begin: number, end: number): ReadableStream<Uint8Array<ArrayBuffer>>;

  onGetRangeReader(fn: (data: { begin: number, end: number }, sink: StreamSink<Uint8Array<ArrayBuffer>>) => void): void;

  ReaderHeadersReady(): Promise<ReaderHeadersReadyResult>;

  onReaderHeadersReady(fn: () => Promise<ReaderHeadersReadyResult>): void;

  GetDoc(numPages: number, fingerprints: [string, string | null]): void;

  onGetDoc(fn: (param: GetDocMessage) => void): void;

  PasswordRequest(ex: PasswordException): Promise<{ password: string }>;

  onPasswordRequest(fn: (ex: PasswordException) => Promise<{ password: string | Error }>): void;

  DocException(ex: BaseException): void;

  onDocException(fn: (ex: BaseException) => void): void;

  DataLoaded(length: number): void;

  onDataLoaded(fn: (data: { length: number }) => void): void;

  StartRenderPage(transparency: boolean, pageIndex: number, cacheKey: string): void;

  onStartRenderPage(fn: (data: StartRenderPageMessage) => void): void;

  DocProgress(loaded: number, total: number): void;

  onDocProgress(fn: (data: OnProgressParameters) => void): void;

  FetchBuiltInCMap(name: string): Promise<FetchBuiltInCMapMessage>;

  onFetchBuiltInCMap(fn: (data: { name: string }) => Promise<FetchBuiltInCMapMessage>): void;

  FetchStandardFontData(filename: string): Promise<Uint8Array<ArrayBuffer>>;

  onFetchStandardFontData(fn: (data: { filename: string }) => Promise<Uint8Array<ArrayBuffer>>): void;

  GetPage(pageIndex: number): Promise<PageInfo>;

  onGetPage(fn: (data: { pageIndex: number }) => Promise<PageInfo>): void;

  GetPageIndex(num: number, gen: number): Promise<number>;

  onGetPageIndex(fn: (ref: { num: number, gen: number }) => Promise<number>): void;

  GetDestinations(): Promise<Map<string, DestinationType>>;

  onGetDestinations(fn: () => Promise<Map<string, DestinationType>>): void;

  GetDestination(id: string): Promise<DestinationType | null>;

  onGetDestination(fn: (data: { id: string }) => Promise<DestinationType | null>): void;

  GetPageLabels(): Promise<string[] | null>;

  onGetPageLabels(fn: () => Promise<string[] | null>): void;

  GetPageLayout(): Promise<string>;

  onGetPageLayout(fn: () => Promise<string>): void;

  GetPageMode(): Promise<string>;

  onGetPageMode(fn: () => Promise<string>): void;

  GetViewerPreferences(): Promise<Map<ViewerPreferenceKeys, string | number | boolean | number[]> | null>;

  onGetViewerPreferences(fn: () => Promise<Map<ViewerPreferenceKeys, string | number | boolean | number[]> | null>): void;

  // TODO GetOpenAction比较复杂，要确定类型
  GetOpenAction(): Promise<CatalogOpenAction | null>;

  onGetOpenAction(fn: () => Promise<CatalogOpenAction | null>): void;

  GetAttachments(): Promise<Map<string, FileSpecSerializable> | null>;

  onGetAttachments(fn: () => Promise<Map<string, FileSpecSerializable> | null>): void;

  GetDocJSActions(): Promise<Map<string, string[]> | null>;

  onGetDocJSActions(fn: () => Promise<Map<string, string[]> | null>): void;

  GetPageJSActions(pageIndex: number): Promise<Map<string, string[]> | null>;

  onGetPageJSActions(fn: (data: { pageIndex: number }) => Promise<Map<string, string[]> | null>): void;

  GetPermissions(): Promise<number[] | null>;

  onGetPermissions(fn: () => Promise<number[] | null>): void;

  GetMarkInfo(): Promise<CatalogMarkInfo | null>;

  onGetMarkInfo(fn: () => Promise<CatalogMarkInfo | null>): void;

  GetData(): Promise<Uint8Array<ArrayBuffer>>;

  onGetData(fn: () => Promise<Uint8Array<ArrayBuffer>>): void;

  GetAnnotations(pageIndex: number, intent: number): Promise<AnnotationData[]>;

  onGetAnnotations(fn: (data: GetAnnotationsMessage) => Promise<AnnotationData[]>): void;

  GetFieldObjects(): Promise<Map<string, FieldObject[]> | null>;

  onGetFieldObjects(fn: () => Promise<Map<string, FieldObject[]> | null>): void;

  HasJSActions(): Promise<boolean>;

  onHasJSActions(fn: () => Promise<boolean>): void;

  GetCalculationOrderIds(): Promise<string[] | null>;

  onGetCalculationOrderIds(fn: () => Promise<string[] | null>): void;

  GetStructTree(pageIndex: number): Promise<StructTreeSerialNode | null>;

  onGetStructTree(fn: (data: { pageIndex: number }) => Promise<StructTreeSerialNode | null>): void;

  GetOutline(): Promise<CatalogOutlineItem[] | null>;

  onGetOutline(fn: () => Promise<CatalogOutlineItem[] | null>): void;

  GetOperatorList(
    pageIndex: number,
    intent: number,
    cacheKey: string,
    annotationStorage: Map<string, AnnotationEditorSerial> | null,
    modifiedIds: Set<string>,
    transfers: Transferable[] | null
  ): ReadableStream<OpertaorListChunk>;

  onGetOperatorList(fn: (data: StreamGetOperatorListParameters, sink: StreamSink<OpertaorListChunk>) => void): void;

  FontFallback(id: string): Promise<void>;

  onFontFallback(fn: (data: { id: string }) => Promise<void>): void;

  Cleanup(): Promise<void>;

  onCleanup(fn: () => Promise<void>): void;

  Terminate(): Promise<void>;

  onTerminate(fn: () => Promise<void>): void;

  GetMetadata(): Promise<[PDFDocumentInfo, PDFMetadataInfo | null]>;

  onGetMetadata(fn: () => Promise<[PDFDocumentInfo, PDFMetadataInfo | null]>): void;

  obj<T extends ObjType>(id: string, page: number, type: T, data: ObjDataType[T], transfers: Transferable[] | null): void;

  obj<T extends ObjType>(id: string, page: number, type: T, data: ObjDataType[T]): void;

  onObj<T extends ObjType>(fn: (res: [string, number, T, ObjDataType[T]]) => void): void;

  commonobj<T extends CommonObjType>(id: string, type: T, data: CommonObjDataType[T], transfers: Transferable[] | null): void;

  commonobj<T extends CommonObjType>(id: string, type: T, data: CommonObjDataType[T]): void;

  commonobjPromise<T extends CommonObjType>(id: string, type: T, data: CommonObjDataType[T]): Promise<number>;

  onCommonobj<T extends CommonObjType>(fn: (res: [string, T, CommonObjDataType[T]]) => Promise<number | null>): void;

  GetTextContent<T>(
    pageIndex: number,
    includeMarkedContent: boolean,
    disableNormalization: boolean,
    queueingStrategy: QueuingStrategy<T>
  ): ReadableStream<EvaluatorTextContent>;

  onGetTextContent(fn: (data: GetTextContentMessage, sink: StreamSink<EvaluatorTextContent>) => void): void;

  GetOptionalContentConfig(): Promise<CatalogOptionalContentConfig | null>;

  onGetOptionalContentConfig(fn: () => Promise<CatalogOptionalContentConfig | null>): void;

  saveDocument(
    numPages: number | null,
    annotationStorage: Map<string, AnnotationEditorSerial> | null,
    filename: string | null,
    transfers: Transferable[] | null
  ): Promise<Uint8TypedArray>;

  onSaveDocument(fn: (data: SaveDocumentMessage) => Promise<Uint8TypedArray>): void;

  Ready(): void;

  onReady(fn: () => void): void;

  ready(): void;

  onready(fn: () => void): void;
}