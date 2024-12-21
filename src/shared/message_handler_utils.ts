

/**
 * 通过具体的类型，将sender和recevier串联起来。
 * 这样一来，调用者知道返回值是什么类型，接受者知道参数类型是什么。
 */
export const MessageHandlerAction = {
  GetDocRequest: "GetDocRequest",
  test: "test",
  Ready: "Ready",
  configure: "configure",
  GetReader: "GetReader",
  ReaderHeadersReady: "ReaderHeadersReady",
  GetRangeReader: "GetRangeReader",
  GetDoc: "GetDoc",
  PasswordRequest: "PasswordRequest",
}