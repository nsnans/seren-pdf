/**
 * 因为MessageHandler处理了约五六十种异步请求，但是对于这些异步请求，却全都缺乏了具体的类型。
 * 这在开发过程中给我带来了太多的困扰，不知道参数，也不知道返回类型，对于后续的处理那更是无从谈起。
 * 因此需要对MessageHandler中的数十种异步请求，做一个统一的整理，确保它们能够正确的处理好参数和返回值。
 * */

import { StreamSink } from "../core/core_types";
import { DocumentParameter, PDFDocumentProxy, PDFDocumentProxyPdfInfo } from "../display/api";
import { AbstractMessageHandler, MessagePoster } from "./message_handler_base";
import { ReaderHeadersReadyResult } from "./message_handler_types";
import { MessageHandlerAction } from "./message_handler_utils";
import { PasswordException } from "./util";

export class MessageHandler extends AbstractMessageHandler {

  constructor(sourceName: string, targetName: string, comObj: MessagePoster) {
    super(sourceName, targetName, comObj);
  }

  GetDocRequest(docParams: DocumentParameter, data: ArrayBuffer[] | null): Promise<string> {
    const action = MessageHandlerAction.GetDocRequest;
    return <Promise<string>>super.sendWithPromise(action, docParams, data);
  }

  onGetDocRequest(fn: (param: DocumentParameter) => string): void {
    const action = MessageHandlerAction.GetDocRequest;
    super.on(action, fn);
  }

  test(data: Uint8Array<ArrayBuffer> | boolean, transfers: Transferable[] | null = null) {
    const test = MessageHandlerAction.test;
    super.send(test, data, transfers);
  }

  onTest(fn: (data: Uint8Array<ArrayBuffer> | boolean, transfers: Transferable[] | null) => void): void {
    const test = MessageHandlerAction.test;
    super.on(test, fn);
  }

  configure(verbosity: number) {
    const configure = MessageHandlerAction.configure;
    super.send(configure, { verbosity });
  }

  onConfigure(fn: (verbosity: { verbosity: number }) => void): void {
    const configure = MessageHandlerAction.configure;
    super.on(configure, fn);
  }

  GetReader() {
    const action = MessageHandlerAction.GetReader;
    // 这里的data是null，onGetReader的data就是null
    const data = null;
    return super.sendWithStream(action, data)
  }

  onGetReader(fn: (data: null, sink: StreamSink) => void) {
    const action = MessageHandlerAction.GetReader;
    super.on(action, fn);
  }

  GetRangeReader(begin: number, end: number) {
    const action = MessageHandlerAction.GetRangeReader;
    return super.sendWithStream(action, { begin, end });
  }

  onGetRangeReader(fn: (data: { begin: number, end: number }, sink: StreamSink) => void) {
    const action = MessageHandlerAction.GetRangeReader;
    super.on(action, fn);
  }

  ReaderHeadersReady(): Promise<ReaderHeadersReadyResult> {
    const action = MessageHandlerAction.ReaderHeadersReady;
    // 这里的data是null，onReaderHeadersReady的data就是null
    return super.sendWithPromise(action, null);
  }

  onReaderHeadersReady(fn: () => Promise<ReaderHeadersReadyResult>) {
    const action = MessageHandlerAction.ReaderHeadersReady;
    super.on(action, fn);
  }

  GetDoc(numPages: number, fingerprints: [string, string | null]) {
    const action = MessageHandlerAction.GetDoc;
    super.send(action, { numPages, fingerprints });
  }

  onGetDoc(fn: (param: { numPages: number, fingerprints: [string, string | null] }) => void) {
    const action = MessageHandlerAction.GetDoc;
    super.on(action, fn);
  }

  PasswordRequest(ex: PasswordException): Promise<{ password: string }> {
    const action = MessageHandlerAction.PasswordRequest;
    return super.sendWithPromise(action, ex);
  }

  onPasswordRequest(fn: (ex: PasswordException) => Promise<{ password: string | Error }>) {
    const action = MessageHandlerAction.PasswordRequest;
    super.on(action, fn);
  }

  Ready(): void {
    const action = MessageHandlerAction.Ready;
    super.send(action, null)
  }

  onReady(fn: () => void) {
    const action = MessageHandlerAction.Ready;
    super.on(action, fn);
  }
}