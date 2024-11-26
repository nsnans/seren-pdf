export interface IPDFLinkService {

}

export interface IDownloadManager {

}

export interface IL10n {
  /**
    * @returns {string} - The current locale.
    */
  getLanguage(): string;

  /**
   * @returns {string} - 'rtl' or 'ltr'.
   */
  getDirection(): 'rtl' | 'ltr';

  /**
   * Translates text identified by the key and adds/formats data using the args
   * property bag. If the key was not found, translation falls back to the
   * fallback text.
   * @param {Array | string} ids
   * @param {Object | null} [args]
   * @param {string} [fallback]
   * @returns {Promise<string>}
   */
  get(ids: Array<string> | string, args: object | null, fallback: string): Promise<string>;

  /**
   * Translates HTML element.
   * @param {HTMLElement} element
   * @returns {Promise<void>}
   */
  translate(element: HTMLElement): Promise<void>

  /**
   * Pause the localization.
   */
  pause(): void;

  /**
   * Resume the localization.
   */
  resume(): void;
}

// Meachine Learning Manager
// 用来推测图片上的文字，在其它浏览器中都没有实现
// 在火狐中可能通过调用了某种方式实现了？？
export class MLManager {

  async isEnabledFor(_name: unknown) {
    return false;
  }

  async deleteModel(_service: unknown) {
    return null;
  }

  isReady(_name: unknown) {
    return false;
  }

  // 这个目前没确定下来具体的返回值，只能先返回any
  guess(_data: unknown): any {
    throw new Error("Unsupported Method")
  }

  toggleService(_name: unknown, _enabled: unknown) { }

  static getFakeMLManager(_options: unknown) {
    throw new Error("Unsupported Method")
  }
}