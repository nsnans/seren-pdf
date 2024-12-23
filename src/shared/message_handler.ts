/**
 * 因为MessageHandler处理了约五六十种异步请求，但是对于这些异步请求，却全都缺乏了具体的类型。
 * 这在开发过程中给我带来了太多的困扰，不知道参数，也不知道返回类型，对于后续的处理那更是无从谈起。
 * 因此需要对MessageHandler中的数十种异步请求，做一个统一的整理，确保它们能够正确的处理好参数和返回值。
 * */

import {
  CatalogMarkInfo,
  CatalogOpenAction,
  DestinationType,
  ViewerPreferenceKeys
} from "../core/catalog";
import { FieldObject, StreamSink } from "../core/core_types";
import { PDFDocumentInfo } from "../core/document";
import { FileSpecSerializable } from "../core/file_spec";
import { PDFMetadataInfo } from "../core/metadata_parser";
import { StructTreeSerialNode } from "../core/struct_tree";
import {
  DocumentParameter,
  OnProgressParameters,
  StructTreeNode
} from "../display/api";
import { AbstractMessageHandler, MessagePoster } from "./message_handler_base";
import {
  FetchBuiltInCMapMessage,
  GetDocMessage,
  GetPageResult,
  GetTextContentMessage,
  ReaderHeadersReadyResult,
  StartRenderPageMessage
} from "./message_handler_types";
import { MessageHandlerAction } from "./message_handler_utils";
import { BaseException, PasswordException } from "./util";

export class MessageHandler extends AbstractMessageHandler {

  constructor(sourceName: string, targetName: string, comObj: MessagePoster) {
    super(sourceName, targetName, comObj);
  }

  GetDocRequest(docParams: DocumentParameter, data: ArrayBuffer[] | null): Promise<string> {
    const action = MessageHandlerAction.GetDocRequest;
    return this.sendWithPromise(action, docParams, data);
  }

  onGetDocRequest(fn: (param: DocumentParameter) => string): void {
    const action = MessageHandlerAction.GetDocRequest;
    this.on(action, fn);
  }

  test(data: Uint8Array<ArrayBuffer> | boolean, transfers: Transferable[] | null = null) {
    const test = MessageHandlerAction.test;
    this.send(test, data, transfers);
  }

  onTest(fn: (data: Uint8Array<ArrayBuffer> | boolean, transfers: Transferable[] | null) => void): void {
    const action = MessageHandlerAction.test;
    this.on(action, fn);
  }

  configure(verbosity: number) {
    const configure = MessageHandlerAction.configure;
    this.send(configure, { verbosity });
  }

  onConfigure(fn: (verbosity: { verbosity: number }) => void): void {
    const action = MessageHandlerAction.configure;
    this.on(action, fn);
  }

  GetReader() {
    const action = MessageHandlerAction.GetReader;
    // 这里的data是null，onGetReader的data就是null
    const data = null;
    return this.sendWithStream(action, data)
  }

  onGetReader(fn: (data: null, sink: StreamSink) => void) {
    const action = MessageHandlerAction.GetReader;
    this.on(action, fn);
  }

  GetRangeReader(begin: number, end: number) {
    const action = MessageHandlerAction.GetRangeReader;
    return this.sendWithStream(action, { begin, end });
  }

  onGetRangeReader(fn: (data: { begin: number, end: number }, sink: StreamSink) => void) {
    const action = MessageHandlerAction.GetRangeReader;
    this.on(action, fn);
  }

  ReaderHeadersReady(): Promise<ReaderHeadersReadyResult> {
    const action = MessageHandlerAction.ReaderHeadersReady;
    // 这里的data是null，onReaderHeadersReady的data就是null
    return this.sendWithPromise(action, null);
  }

  onReaderHeadersReady(fn: () => Promise<ReaderHeadersReadyResult>) {
    const action = MessageHandlerAction.ReaderHeadersReady;
    this.on(action, fn);
  }

  GetDoc(numPages: number, fingerprints: [string, string | null]) {
    const action = MessageHandlerAction.GetDoc;
    const data: GetDocMessage = { numPages, fingerprints };
    this.send(action, data);
  }

  onGetDoc(fn: (param: GetDocMessage) => void) {
    const action = MessageHandlerAction.GetDoc;
    this.on(action, fn);
  }

  PasswordRequest(ex: PasswordException): Promise<{ password: string }> {
    const action = MessageHandlerAction.PasswordRequest;
    return this.sendWithPromise(action, ex);
  }

  onPasswordRequest(fn: (ex: PasswordException) => Promise<{ password: string | Error }>) {
    const action = MessageHandlerAction.PasswordRequest;
    this.on(action, fn);
  }

  DocException(ex: BaseException) {
    const action = MessageHandlerAction.DocException;
    this.send(action, ex);
  }

  onDocException(fn: (ex: BaseException) => void) {
    const action = MessageHandlerAction.DocException;
    this.on(action, fn);
  }

  DataLoaded(length: number) {
    const action = MessageHandlerAction.DataLoaded;
    this.send(action, { length })
  }

  onDataLoaded(fn: (data: { length: number }) => void) {
    const action = MessageHandlerAction.DataLoaded;
    this.on(action, fn);
  }

  StartRenderPage(transparency: boolean, pageIndex: number, cacheKey: string) {
    const action = MessageHandlerAction.StartRenderPage;
    const data: StartRenderPageMessage = { transparency, pageIndex, cacheKey }
    this.send(action, data);
  }

  onStartRenderPage(fn: (data: StartRenderPageMessage) => void) {
    const action = MessageHandlerAction.StartRenderPage;
    this.on(action, fn);
  }

  DocProgress(loaded: number, total: number) {
    const action = MessageHandlerAction.DocProgress;
    this.send(action, { loaded, total });
  }

  onDocProgress(fn: (data: OnProgressParameters) => void) {
    const action = MessageHandlerAction.DocProgress;
    this.on(action, fn);
  }

  FetchBuiltInCMap(name: string): Promise<FetchBuiltInCMapMessage> {
    const action = MessageHandlerAction.FetchBuiltInCMap;
    return this.sendWithPromise(action, { name });
  }

  onFetchBuiltInCMap(fn: (data: { name: string }) => Promise<FetchBuiltInCMapMessage>) {
    const action = MessageHandlerAction.FetchBuiltInCMap;
    this.on(action, fn);
  }

  FetchStandardFontData(filename: string): Promise<Uint8Array<ArrayBuffer>> {
    const action = MessageHandlerAction.FetchStandardFontData;
    return this.sendWithPromise(action, { filename });
  }

  onFetchStandardFontData(fn: (data: { filename: string }) => Promise<Uint8Array<ArrayBuffer>>) {
    const action = MessageHandlerAction.FetchStandardFontData;
    this.on(action, fn);
  }

  GetPage(pageIndex: number): Promise<GetPageResult> {
    const action = MessageHandlerAction.GetPage;
    return this.sendWithPromise(action, { pageIndex });
  }

  onGetPage(fn: (data: { pageIndex: number }) => Promise<GetPageResult>) {
    const action = MessageHandlerAction.GetPage;
    this.on(action, fn);
  }

  GetPageIndex(num: number, gen: number): Promise<number> {
    const action = MessageHandlerAction.GetPageIndex;
    return this.sendWithPromise(action, { num, gen })
  }

  onGetPageIndex(fn: (ref: { num: number, gen: number }) => Promise<number>) {
    const action = MessageHandlerAction.GetPageIndex;
    this.on(action, fn);
  }

  GetDestinations(): Promise<Map<string, DestinationType>> {
    const action = MessageHandlerAction.GetDestinations;
    return this.sendWithPromise(action, null);
  }

  onGetDestinations(fn: () => Promise<Map<string, DestinationType>>) {
    const action = MessageHandlerAction.GetDestinations;
    this.on(action, fn);
  }

  GetDestination(id: string): Promise<DestinationType | null> {
    const action = MessageHandlerAction.GetDestination;
    return this.sendWithPromise(action, { id });
  }

  onGetDestination(fn: (data: { id: string }) => Promise<DestinationType | null>) {
    const action = MessageHandlerAction.GetDestination;
    this.on(action, fn);
  }

  GetPageLabels(): Promise<string[] | null> {
    const action = MessageHandlerAction.GetPageLabels;
    return this.sendWithPromise(action, null);
  }

  onGetPageLabels(fn: () => Promise<string[] | null>) {
    const action = MessageHandlerAction.GetPageLabels;
    this.on(action, fn);
  }

  GetPageLayout(): Promise<string> {
    const action = MessageHandlerAction.GetPageLayout;
    return this.sendWithPromise(action, null);
  }

  onGetPageLayout(fn: () => Promise<string>) {
    const action = MessageHandlerAction.GetPageLayout;
    this.on(action, fn);
  }

  GetPageMode(): Promise<string> {
    const action = MessageHandlerAction.GetPageMode;
    return this.sendWithPromise(action, null);
  }

  onGetPageMode(fn: () => Promise<string>) {
    const action = MessageHandlerAction.GetPageMode;
    this.on(action, fn);
  }

  GetViewerPreferences(): Promise<Map<ViewerPreferenceKeys, string | number | boolean | number[]> | null> {
    const action = MessageHandlerAction.GetViewerPreferences;
    return this.sendWithPromise(action, null);
  }

  onGetViewerPreferences(fn: () => Promise<Map<ViewerPreferenceKeys, string | number | boolean | number[]> | null>) {
    const action = MessageHandlerAction.GetViewerPreferences;
    this.on(action, fn);
  }

  // TODO GetOpenAction比较复杂，要确定类型
  GetOpenAction(): Promise<CatalogOpenAction | null> {
    const action = MessageHandlerAction.GetOpenAction;
    return this.sendWithPromise(action, null);
  }

  onGetOpenAction(fn: () => Promise<CatalogOpenAction | null>) {
    const action = MessageHandlerAction.GetOpenAction;
    this.on(action, fn);
  }

  GetAttachments(): Promise<Map<string, FileSpecSerializable> | null> {
    const action = MessageHandlerAction.GetAttachments;
    return this.sendWithPromise(action, null);
  }

  onGetAttachments(fn: () => Promise<Map<string, FileSpecSerializable> | null>) {
    const action = MessageHandlerAction.GetAttachments;
    this.on(action, fn);
  }

  GetDocJSActions(): Promise<Map<string, string[]> | null> {
    const action = MessageHandlerAction.GetDocJSActions;
    return this.sendWithPromise(action, null);
  }

  onGetDocJSActions(fn: () => Promise<Map<string, string[]> | null>) {
    const action = MessageHandlerAction.GetDocJSActions;
    this.on(action, fn);
  }

  GetPageJSActions(pageIndex: number): Promise<Map<string, string[]> | null> {
    const action = MessageHandlerAction.GetPageJSActions;
    return this.sendWithPromise(action, { pageIndex })
  }

  onGetPageJSActions(fn: (data: { pageIndex: number }) => Promise<Map<string, string[]> | null>) {
    const action = MessageHandlerAction.GetPageJSActions;
    this.on(action, fn);
  }

  GetPermissions(): Promise<string[] | null> {
    const action = MessageHandlerAction.GetPermissions;
    return this.sendWithPromise(action, null);
  }

  onGetPermissions(fn: () => Promise<string[] | null>) {
    const action = MessageHandlerAction.GetPermissions;
    this.on(action, fn);
  }

  GetMarkInfo(): Promise<CatalogMarkInfo | null> {
    const action = MessageHandlerAction.GetPermissions;
    return this.sendWithPromise(action, null);
  }

  onGetMarkInfo(fn: () => Promise<CatalogMarkInfo | null>) {
    const action = MessageHandlerAction.GetPermissions;
    this.on(action, fn);
  }

  GetData(): Promise<Uint8Array<ArrayBuffer>> {
    const action = MessageHandlerAction.GetData;
    return this.sendWithPromise(action, null);
  }

  onGetData(fn: () => Promise<Uint8Array<ArrayBuffer>>) {
    const action = MessageHandlerAction.GetData;
    this.on(action, fn);
  }

  GetAnnotations(pageIndex: number, intent: number) {
    const action = MessageHandlerAction.GetAnnotations;
    return this.sendWithPromise(action, { pageIndex, intent });
  }

  GetFieldObjects(): Promise<Map<string, FieldObject[]> | null> {
    const action = MessageHandlerAction.GetFieldObjects;
    return this.sendWithPromise(action, null);
  }

  onGetFieldObjects(fn: () => Promise<Map<string, FieldObject[]> | null>) {
    const action = MessageHandlerAction.GetFieldObjects;
    this.on(action, fn);
  }

  HasJSActions(): Promise<boolean> {
    const action = MessageHandlerAction.HasJSActions;
    return this.sendWithPromise(action, null);
  }

  onHasJSActions(fn: () => Promise<boolean>) {
    const action = MessageHandlerAction.HasJSActions;
    this.on(action, fn);
  }

  GetCalculationOrderIds(): Promise<string[] | null> {
    const action = MessageHandlerAction.GetCalculationOrderIds;
    return this.sendWithPromise(action, null);
  }

  onGetCalculationOrderIds(fn: () => Promise<string[] | null>) {
    const action = MessageHandlerAction.GetCalculationOrderIds;
    this.on(action, fn);
  }

  GetStructTree(pageIndex: number): Promise<StructTreeSerialNode | null> {
    const action = MessageHandlerAction.GetStructTree;
    return this.sendWithPromise(action, { pageIndex })
  }

  onGetStructTree(fn: (data: { pageIndex: number }) => Promise<StructTreeSerialNode | null>) {
    const action = MessageHandlerAction.GetStructTree;
    this.on(action, fn);
  }

  FontFallback(id: string): Promise<void> {
    const action = MessageHandlerAction.FontFallback;
    return this.sendWithPromise(action, { id });
  }

  onFontFallback(fn: (data: { id: string }) => Promise<void>) {
    const action = MessageHandlerAction.FontFallback;
    this.on(action, fn);
  }

  Cleanup(): Promise<void> {
    const action = MessageHandlerAction.Cleanup;
    return this.sendWithPromise(action, null)
  }

  onCleanup(fn: () => Promise<void>) {
    const action = MessageHandlerAction.Cleanup;
    this.on(action, fn);
  }

  Terminate(): Promise<void> {
    const action = MessageHandlerAction.Terminate;
    return this.sendWithPromise(action, null);
  }

  onTerminate(fn: () => Promise<void>) {
    const action = MessageHandlerAction.Terminate;
    this.on(action, fn);
  }

  GetMetadata(): Promise<[PDFDocumentInfo, PDFMetadataInfo | null]> {
    const action = MessageHandlerAction.GetMetadata;
    return this.sendWithPromise(action, null);
  }

  onGetMetadata(fn: () => Promise<[PDFDocumentInfo, PDFMetadataInfo | null]>) {
    const action = MessageHandlerAction.GetMetadata;
    this.on(action, fn);
  }

  // 这里的any是不得已而为之
  obj(id: string, page: number, type: string, data: any, transfers: Transferable[] | null = null) {
    const action = MessageHandlerAction.obj;
    this.send(action, [id, page, type, data], transfers)
  }

  onObj(fn: (res: [string, number, string, any]) => void) {
    const action = MessageHandlerAction.obj;
    this.on(action, fn);
  }

  // 这里的any是不得已而为之
  commonobj(id: string, type: string, data: any, transfers: Transferable[] | null = null) {
    const action = MessageHandlerAction.commonobj;
    this.send(action, [id, type, data], transfers);
  }

  commonobjPromise(id: string, type: string, data: any): Promise<number> {
    const action = MessageHandlerAction.commonobj;
    return this.sendWithPromise(action, [id, type, data]);
  }

  onCommonobj(fn: (res: [string, string, any]) => Promise<number | null>) {
    const action = MessageHandlerAction.commonobj;
    this.on(action, fn);
  }

  GetTextContent<T>(
    pageIndex: number,
    includeMarkedContent: boolean,
    disableNormalization: boolean,
    queueingStrategy: QueuingStrategy<T>
  ): ReadableStream<Uint8Array<ArrayBuffer>> {
    const action = MessageHandlerAction.GetTextContent;
    const data: GetTextContentMessage = {
      pageIndex,
      includeMarkedContent,
      disableNormalization
    };
    return this.sendWithStream(action, data, queueingStrategy)
  }

  onGetTextContent(fn: (data: GetTextContentMessage, sink: StreamSink) => void) {
    const action = MessageHandlerAction.GetTextContent;
    this.on(action, fn);
  }

  Ready(): void {
    const action = MessageHandlerAction.Ready;
    this.send(action, null)
  }

  onReady(fn: () => void) {
    const action = MessageHandlerAction.Ready;
    this.on(action, fn);
  }

  ready(): void {
    const action = MessageHandlerAction.ready;
    this.send(action, null)
  }

  onready(fn: () => void) {
    const action = MessageHandlerAction.ready;
    this.on(action, fn);
  }
}