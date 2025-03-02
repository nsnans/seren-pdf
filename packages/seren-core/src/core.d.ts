
// 扩展 window 对象，添加 一些全局 属性
export declare global {

  /**
   * 因为DataView要做Uint8Array的构造参数。但是DataView又不能做Uint8Array的构造函数。
   * 需要返回一个数字的迭代器，因此在这里需要补一下。我不太确定这是不是因为node相关导致的。
   */
  interface DataView<TArrayBuffer extends ArrayBufferLike> {
    [Symbol.iterator](): Iterator<number, number, number>;
  }
}
