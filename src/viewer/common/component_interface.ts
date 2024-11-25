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