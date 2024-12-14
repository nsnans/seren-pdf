/* Copyright 2021 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Namespace } from "./namespace";
import { NamespaceIds } from "./namespaces";
import { getInteger, getStringOption } from "./utils";
import {
  ContentObject,
  StringObject,
  XFAAttributesObj,
  XFAObject,
  XFAObjectArray,
} from "./xfa_object";

const LOCALE_SET_NS_ID = NamespaceIds.localeSet.id;

class CalendarSymbols extends XFAObject {

  protected dayNames = new XFAObjectArray(2);

  protected monthNames = new XFAObjectArray(2);

  protected name = "gregorian";

  constructor(_attributes: XFAAttributesObj) {
    super(LOCALE_SET_NS_ID, "calendarSymbols", /* hasChildren = */ true);
    this.eraNames = null;
    this.meridiemNames = null;
  }
}

class CurrencySymbol extends StringObject {
  constructor(attributes: XFAAttributesObj) {
    super(LOCALE_SET_NS_ID, "currencySymbol");
    this.name = getStringOption(attributes.name, [
      "symbol",
      "isoname",
      "decimal",
    ]);
  }
}

class CurrencySymbols extends XFAObject {
  constructor(_attributes: XFAAttributesObj) {
    super(LOCALE_SET_NS_ID, "currencySymbols", /* hasChildren = */ true);
    this.currencySymbol = new XFAObjectArray(3);
  }
}

class DatePattern extends StringObject {
  constructor(attributes: XFAAttributesObj) {
    super(LOCALE_SET_NS_ID, "datePattern");
    this.name = getStringOption(attributes.name, [
      "full",
      "long",
      "med",
      "short",
    ]);
  }
}

class DatePatterns extends XFAObject {
  constructor(_attributes: XFAAttributesObj) {
    super(LOCALE_SET_NS_ID, "datePatterns", /* hasChildren = */ true);
    this.datePattern = new XFAObjectArray(4);
  }
}

class DateTimeSymbols extends ContentObject {
  // TODO: spec unclear about the format of the array.

  constructor(_attributes: XFAAttributesObj) {
    super(LOCALE_SET_NS_ID, "dateTimeSymbols");
  }
}

class Day extends StringObject {
  constructor(_attributes: XFAAttributesObj) {
    super(LOCALE_SET_NS_ID, "day");
  }
}

class DayNames extends XFAObject {
  constructor(attributes: XFAAttributesObj) {
    super(LOCALE_SET_NS_ID, "dayNames", /* hasChildren = */ true);
    this.abbr = getInteger(
      attributes.abbr,
      0,
      x => x === 1,
    );
    this.day = new XFAObjectArray(7);
  }
}

class Era extends StringObject {
  constructor(_attributes: XFAAttributesObj) {
    super(LOCALE_SET_NS_ID, "era");
  }
}

class EraNames extends XFAObject {
  constructor(_attributes: XFAAttributesObj) {
    super(LOCALE_SET_NS_ID, "eraNames", /* hasChildren = */ true);
    this.era = new XFAObjectArray(2);
  }
}

class Locale extends XFAObject {
  constructor(attributes: XFAAttributesObj) {
    super(LOCALE_SET_NS_ID, "locale", /* hasChildren = */ true);
    this.desc = attributes.desc || "";
    this.name = "isoname";
    this.calendarSymbols = null;
    this.currencySymbols = null;
    this.datePatterns = null;
    this.dateTimeSymbols = null;
    this.numberPatterns = null;
    this.numberSymbols = null;
    this.timePatterns = null;
    this.typeFaces = null;
  }
}

class LocaleSet extends XFAObject {
  constructor(_attributes: XFAAttributesObj) {
    super(LOCALE_SET_NS_ID, "localeSet", /* hasChildren = */ true);
    this.locale = new XFAObjectArray();
  }
}

class Meridiem extends StringObject {
  constructor(_attributes: XFAAttributesObj) {
    super(LOCALE_SET_NS_ID, "meridiem");
  }
}

class MeridiemNames extends XFAObject {
  constructor(_attributes: XFAAttributesObj) {
    super(LOCALE_SET_NS_ID, "meridiemNames", /* hasChildren = */ true);
    this.meridiem = new XFAObjectArray(2);
  }
}

class Month extends StringObject {
  constructor(_attributes: XFAAttributesObj) {
    super(LOCALE_SET_NS_ID, "month");
  }
}

class MonthNames extends XFAObject {
  constructor(attributes: XFAAttributesObj) {
    super(LOCALE_SET_NS_ID, "monthNames", /* hasChildren = */ true);
    this.abbr = getInteger(
      attributes.abbr,
      0,
      x => x === 1,
    );
    this.month = new XFAObjectArray(12);
  }
}

class NumberPattern extends StringObject {
  constructor(attributes: XFAAttributesObj) {
    super(LOCALE_SET_NS_ID, "numberPattern");
    this.name = getStringOption(attributes.name, [
      "full",
      "long",
      "med",
      "short",
    ]);
  }
}

class NumberPatterns extends XFAObject {
  constructor(_attributes: XFAAttributesObj) {
    super(LOCALE_SET_NS_ID, "numberPatterns", /* hasChildren = */ true);
    this.numberPattern = new XFAObjectArray(4);
  }
}

class NumberSymbol extends StringObject {
  constructor(attributes: XFAAttributesObj) {
    super(LOCALE_SET_NS_ID, "numberSymbol");
    this.name = getStringOption(attributes.name, [
      "decimal",
      "grouping",
      "percent",
      "minus",
      "zero",
    ]);
  }
}

class NumberSymbols extends XFAObject {
  constructor(_attributes: XFAAttributesObj) {
    super(LOCALE_SET_NS_ID, "numberSymbols", /* hasChildren = */ true);
    this.numberSymbol = new XFAObjectArray(5);
  }
}

class TimePattern extends StringObject {
  constructor(attributes: XFAAttributesObj) {
    super(LOCALE_SET_NS_ID, "timePattern");
    this.name = getStringOption(attributes.name, [
      "full",
      "long",
      "med",
      "short",
    ]);
  }
}

class TimePatterns extends XFAObject {
  constructor(_attributes: XFAAttributesObj) {
    super(LOCALE_SET_NS_ID, "timePatterns", /* hasChildren = */ true);
    this.timePattern = new XFAObjectArray(4);
  }
}

class TypeFace extends XFAObject {
  constructor(attributes: XFAAttributesObj) {
    super(LOCALE_SET_NS_ID, "typeFace", /* hasChildren = */ true);
    this.name = attributes.name | "";
  }
}

class TypeFaces extends XFAObject {
  constructor(_attributes: XFAAttributesObj) {
    super(LOCALE_SET_NS_ID, "typeFaces", /* hasChildren = */ true);
    this.typeFace = new XFAObjectArray();
  }
}

class LocaleSetNamespace implements Namespace {

  public static readonly DEFAULT = new LocaleSetNamespace();

  protected constructor() { }

  buildXFAObject(name: string, attributes: XFAAttributesObj) {
    if (this.hasOwnProperty(name)) {
      return (this as any)[name](attributes);
    }
    return undefined;
  }

  calendarSymbols(attrs: XFAAttributesObj) {
    return new CalendarSymbols(attrs);
  }

  currencySymbol(attrs: XFAAttributesObj) {
    return new CurrencySymbol(attrs);
  }

  currencySymbols(attrs: XFAAttributesObj) {
    return new CurrencySymbols(attrs);
  }

  datePattern(attrs: XFAAttributesObj) {
    return new DatePattern(attrs);
  }

  datePatterns(attrs: XFAAttributesObj) {
    return new DatePatterns(attrs);
  }

  dateTimeSymbols(attrs: XFAAttributesObj) {
    return new DateTimeSymbols(attrs);
  }

  day(attrs: XFAAttributesObj) {
    return new Day(attrs);
  }

  dayNames(attrs: XFAAttributesObj) {
    return new DayNames(attrs);
  }

  era(attrs: XFAAttributesObj) {
    return new Era(attrs);
  }

  eraNames(attrs: XFAAttributesObj) {
    return new EraNames(attrs);
  }

  locale(attrs: XFAAttributesObj) {
    return new Locale(attrs);
  }

  localeSet(attrs: XFAAttributesObj) {
    return new LocaleSet(attrs);
  }

  meridiem(attrs: XFAAttributesObj) {
    return new Meridiem(attrs);
  }

  meridiemNames(attrs: XFAAttributesObj) {
    return new MeridiemNames(attrs);
  }

  month(attrs: XFAAttributesObj) {
    return new Month(attrs);
  }

  monthNames(attrs: XFAAttributesObj) {
    return new MonthNames(attrs);
  }

  numberPattern(attrs: XFAAttributesObj) {
    return new NumberPattern(attrs);
  }

  numberPatterns(attrs: XFAAttributesObj) {
    return new NumberPatterns(attrs);
  }

  numberSymbol(attrs: XFAAttributesObj) {
    return new NumberSymbol(attrs);
  }

  numberSymbols(attrs: XFAAttributesObj) {
    return new NumberSymbols(attrs);
  }

  timePattern(attrs: XFAAttributesObj) {
    return new TimePattern(attrs);
  }

  timePatterns(attrs: XFAAttributesObj) {
    return new TimePatterns(attrs);
  }

  typeFace(attrs: XFAAttributesObj) {
    return new TypeFace(attrs);
  }

  typeFaces(attrs: XFAAttributesObj) {
    return new TypeFaces(attrs);
  }
}

export { LocaleSetNamespace };
