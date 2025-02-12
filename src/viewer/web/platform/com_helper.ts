import { PlatformHelper } from "../../../platform/platform_helper";
import { ChromePreferences } from "./chromecom";
import { FirefoxPreferences } from "./firefoxcom";
import { GenericPreferences } from "./genericcom";
import { Preferences } from "./preferences";

export class PreferencesUtil {

  static initPreference(): Preferences {
    if(PlatformHelper.isChrome()){
      return new ChromePreferences();
    }else if(PlatformHelper.isMozCental()){
      return new FirefoxPreferences()
    }else{
      return new GenericPreferences();
    }
  }
}