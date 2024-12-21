/**
 * 因为MessageHandler处理了约五六十种异步请求，但是对于这些异步请求，却全都缺乏了具体的类型。
 * 这在开发过程中给我带来了太多的困扰，不知道参数，也不知道返回类型，对于后续的处理那更是无从谈起。
 * 因此需要对MessageHandler中的数十种异步请求，做一个统一的整理，确保它们能够正确的处理好参数和返回值。
 * */

import { MessageHandler } from "./message_handler";

export class ExplicitMessageHandler {

  protected readonly messageHandler: MessageHandler;

  constructor(messageHandler: MessageHandler) {
    this.messageHandler = messageHandler;
  }

  configure() {
    
  }

  onConfigure() {
    
  }

  onReady() {

  }
}