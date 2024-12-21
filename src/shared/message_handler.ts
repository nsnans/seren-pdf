/**
 * 因为MessageHandler处理了约五六十种异步请求，但是对于这些异步请求，却全都缺乏了具体的类型。
 * 这在开发过程中给我带来了太多的困扰，不知道参数，也不知道返回类型，对于后续的处理那更是无从谈起。
 * 因此需要对MessageHandler中的数十种异步请求，做一个统一的整理，确保它们能够正确的处理好参数和返回值。
 * */

import { DocumentParameter } from "../display/api";
import { AbstractMessageHandler, MessagePoster } from "./message_handler_base";
import { MessageHandlerActions } from "./message_handler_utils";

export class MessageHandler extends AbstractMessageHandler {

  constructor(sourceName: string, targetName: string, comObj: MessagePoster) {
    super(sourceName, targetName, comObj);
  }

  GetDocRequest(docParams: DocumentParameter, data: ArrayBuffer[] | null): Promise<string> {
    const action = MessageHandlerActions.GetDocRequest;
    return <Promise<string>>super.sendWithPromise(action, docParams, data);
  }

  onGetDocRequest(fn: (param: DocumentParameter) => string): void {
    const action = MessageHandlerActions.GetDocRequest;
    super.on(action, fn);
  }

  test(data: Uint8Array<ArrayBuffer> | boolean, transfers: Transferable[] | null = null) {
    const test = MessageHandlerActions.test;
    super.send(test, data, transfers);
  }

  onTest(fn: (data: Uint8Array<ArrayBuffer> | boolean, transfers: Transferable[] | null) => void): void {
    const test = MessageHandlerActions.test;
    super.on(test, fn);
  }

  configure(verbosity: number) {
    const configure = MessageHandlerActions.configure;
    super.send(configure, { verbosity });
  }

  onConfigure(fn: (verbosity: { verbosity: number }) => void): void {
    const configure = MessageHandlerActions.configure;
    super.on(configure, fn);
  }

  Ready(): void {
    const action = MessageHandlerActions.Ready;
    super.send(action, null)
  }
}