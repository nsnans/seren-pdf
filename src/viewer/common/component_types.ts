
/**
* Simple event bus for an application. Listeners are attached using the `on`
* and `off` methods. To raise an event, the `dispatch` method shall be used.
*/
export class EventBus {

  // 不应该一直是string，这个代码后面需要完善
  on(_action: string, _callback: Function, _options?: unknown) { }
  _on(_action: string, _callback: Function, _options?: unknown) { }

  off() { }

  dispatch(_action: string, _data: unknown) {
  }
}

export interface PDFLinkService {

  eventBus: EventBus;

  addLinkAttributes(link: HTMLAnchorElement, url: string, newWindow: boolean): void;

  getAnchorUrl(param: string): string;

  executeNamedAction(action: string): void;

  // 可能不是string
  executeSetOCGState(action: { state: string[], preserveRB: boolean; }): void;

  getDestinationHash(destination: string): string;

  goToDestination(destination: string): void;

}

export interface DownloadManager {

  // content 有可能是 BlobPart
  openOrDownloadData(content: string | Uint8Array<ArrayBuffer>, filename: string, dest: string | null): void;

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
  get(ids: Array<string> | string, args: object | null, fallback?: string): Promise<string>;

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