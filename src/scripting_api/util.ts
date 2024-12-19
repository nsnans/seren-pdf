/* Copyright 2020 Mozilla Foundation
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

import { PDFObject } from "./pdf_object";

class Util extends PDFObject {

  #dateActionsCache: Map<string, any> | null = null;

  protected _scandCache: Map<string, [string, ((value: string, data: unknown) => void)[]]>;

  protected _months: string[];

  protected _days: string[];

  protected MILLISECONDS_IN_DAY: number;

  protected MILLISECONDS_IN_WEEK: number;
  
  protected _externalCall: any;

  constructor(data) {
    super(data);

    this._scandCache = new Map();
    this._months = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    this._days = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    this.MILLISECONDS_IN_DAY = 86400000;
    this.MILLISECONDS_IN_WEEK = 604800000;

    // used with crackURL
    this._externalCall = data.externalCall;
  }

  printf(...args) {
    if (args.length === 0) {
      throw new Error("Invalid number of params in printf");
    }

    if (typeof args[0] !== "string") {
      throw new TypeError("First argument of printf must be a string");
    }

    const pattern = /%(,[0-4])?([+ 0#]+)?(\d+)?(\.\d+)?(.)/g;
    const PLUS = 1;
    const SPACE = 2;
    const ZERO = 4;
    const HASH = 8;
    let i = 0;
    return args[0].replaceAll(
      pattern,
      function (_match, nDecSep, cFlags, nWidth, nPrecision, cConvChar) {
        // cConvChar must be one of d, f, s, x
        if (
          cConvChar !== "d" &&
          cConvChar !== "f" &&
          cConvChar !== "s" &&
          cConvChar !== "x"
        ) {
          const buf = ["%"];
          for (const str of [nDecSep, cFlags, nWidth, nPrecision, cConvChar]) {
            if (str) {
              buf.push(str);
            }
          }
          return buf.join("");
        }

        i++;
        if (i === args.length) {
          throw new Error("Not enough arguments in printf");
        }
        const arg = args[i];

        if (cConvChar === "s") {
          return arg.toString();
        }

        let flags = 0;
        if (cFlags) {
          for (const flag of cFlags) {
            switch (flag) {
              case "+":
                flags |= PLUS;
                break;
              case " ":
                flags |= SPACE;
                break;
              case "0":
                flags |= ZERO;
                break;
              case "#":
                flags |= HASH;
                break;
            }
          }
        }
        cFlags = flags;

        if (nWidth) {
          nWidth = parseInt(nWidth);
        }

        let intPart: string | number = Math.trunc(arg);

        if (cConvChar === "x") {
          let hex = Math.abs(intPart).toString(16).toUpperCase();
          if (nWidth !== undefined) {
            hex = hex.padStart(nWidth, cFlags & ZERO ? "0" : " ");
          }
          if (cFlags & HASH) {
            hex = `0x${hex}`;
          }
          return hex;
        }

        if (nPrecision) {
          nPrecision = parseInt(nPrecision.substring(1));
        }

        nDecSep = nDecSep ? nDecSep.substring(1) : "0";
        const separators = {
          0: [",", "."],
          1: ["", "."],
          2: [".", ","],
          3: ["", ","],
          4: ["'", "."],
        } as Record<number, [string, string]>;
        const [thousandSep, decimalSep] = separators[nDecSep];

        let decPart = "";
        if (cConvChar === "f") {
          decPart =
            nPrecision !== undefined
              ? Math.abs(arg - intPart).toFixed(nPrecision)
              : Math.abs(arg - intPart).toString();
          if (decPart.length > 2) {
            if (/^1\.0+$/.test(decPart)) {
              intPart += Math.sign(arg);
              decPart = `${decimalSep}${decPart.split(".")[1]}`;
            } else {
              decPart = `${decimalSep}${decPart.substring(2)}`;
            }
          } else {
            if (decPart === "1") {
              intPart += Math.sign(arg);
            }
            decPart = cFlags & HASH ? "." : "";
          }
        }

        let sign = "";
        if (intPart < 0) {
          sign = "-";
          intPart = -intPart;
        } else if (cFlags & PLUS) {
          sign = "+";
        } else if (cFlags & SPACE) {
          sign = " ";
        }

        if (thousandSep && intPart >= 1000) {
          const buf = [];
          while (true) {
            buf.push((intPart % 1000).toString().padStart(3, "0"));
            intPart = Math.trunc(intPart / 1000);
            if (intPart < 1000) {
              buf.push(intPart.toString());
              break;
            }
          }
          intPart = buf.reverse().join(thousandSep);
        } else {
          intPart = intPart.toString();
        }

        let n = `${intPart}${decPart}`;
        if (nWidth !== undefined) {
          n = n.padStart(nWidth - sign.length, cFlags & ZERO ? "0" : " ");
        }

        return `${sign}${n}`;
      }
    );
  }

  iconStreamFromIcon() {
    /* Not implemented */
  }

  printd(cFormat: string | 0 | 1 | 2, oDate: Date): string {
    switch (cFormat) {
      case 0:
        return this.printd("D:yyyymmddHHMMss", oDate);
      case 1:
        return this.printd("yyyy.mm.dd HH:MM:ss", oDate);
      case 2:
        return this.printd("m/d/yy h:MM:ss tt", oDate);
    }

    const handlers = {
      mmmm: (data: { month: number }) => this._months[data.month],
      mmm: (data: { month: number }) => this._months[data.month].substring(0, 3),
      mm: (data: { month: number }) => (data.month + 1).toString().padStart(2, "0"),
      m: (data: { month: number }) => (data.month + 1).toString(),
      dddd: (data: { dayOfWeek: number }) => this._days[data.dayOfWeek],
      ddd: (data: { dayOfWeek: number }) => this._days[data.dayOfWeek].substring(0, 3),
      dd: (data: { day: number }) => data.day.toString().padStart(2, "0"),
      d: (data: { day: number }) => data.day.toString(),
      yyyy: (data: { year: number }) => data.year.toString(),
      yy: (data: { year: number }) => (data.year % 100).toString().padStart(2, "0"),
      HH: (data: { hours: number }) => data.hours.toString().padStart(2, "0"),
      H: (data: { hours: number }) => data.hours.toString(),
      hh: (data: { hours: number }) => (1 + ((data.hours + 11) % 12)).toString().padStart(2, "0"),
      h: (data: { hours: number }) => (1 + ((data.hours + 11) % 12)).toString(),
      MM: (data: { minutes: number }) => data.minutes.toString().padStart(2, "0"),
      M: (data: { minutes: number }) => data.minutes.toString(),
      ss: (data: { seconds: number }) => data.seconds.toString().padStart(2, "0"),
      s: (data: { seconds: number }) => data.seconds.toString(),
      tt: (data: { hours: number }) => (data.hours < 12 ? "am" : "pm"),
      t: (data: { hours: number }) => (data.hours < 12 ? "a" : "p"),
    } as Record<string, (data: unknown) => string>;

    const data = {
      year: oDate.getFullYear(),
      month: oDate.getMonth(),
      day: oDate.getDate(),
      dayOfWeek: oDate.getDay(),
      hours: oDate.getHours(),
      minutes: oDate.getMinutes(),
      seconds: oDate.getSeconds(),
    };

    const patterns =
      /(mmmm|mmm|mm|m|dddd|ddd|dd|d|yyyy|yy|HH|H|hh|h|MM|M|ss|s|tt|t|\\.)/g;
    return cFormat.replaceAll(patterns, function (_match: string, pattern: string) {
      if (pattern in handlers) {
        // 将就一下吧
        return (handlers as any)[pattern](data);
      }
      return pattern.charCodeAt(1);
    });
  }

  printx(cFormat: string[], cSource: string | null) {
    // case
    cSource = (cSource ?? "").toString();
    const handlers = [(x: string) => x, (x: string) => x.toUpperCase(), (x: string) => x.toLowerCase()];
    const buf = <string[]>[];
    let i = 0;
    const ii = cSource.length;
    let currCase = handlers[0];
    let escaped = false;

    for (const command of cFormat) {
      if (escaped) {
        buf.push(command);
        escaped = false;
        continue;
      }
      if (i >= ii) {
        break;
      }
      switch (command) {
        case "?":
          buf.push(currCase(cSource.charAt(i++)));
          break;
        case "X":
          while (i < ii) {
            const char = cSource.charAt(i++);
            if (
              ("a" <= char && char <= "z") ||
              ("A" <= char && char <= "Z") ||
              ("0" <= char && char <= "9")
            ) {
              buf.push(currCase(char));
              break;
            }
          }
          break;
        case "A":
          while (i < ii) {
            const char = cSource.charAt(i++);
            if (("a" <= char && char <= "z") || ("A" <= char && char <= "Z")) {
              buf.push(currCase(char));
              break;
            }
          }
          break;
        case "9":
          while (i < ii) {
            const char = cSource.charAt(i++);
            if ("0" <= char && char <= "9") {
              buf.push(char);
              break;
            }
          }
          break;
        case "*":
          while (i < ii) {
            buf.push(currCase(cSource.charAt(i++)));
          }
          break;
        case "\\":
          escaped = true;
          break;
        case ">":
          currCase = handlers[1];
          break;
        case "<":
          currCase = handlers[2];
          break;
        case "=":
          currCase = handlers[0];
          break;
        default:
          buf.push(command);
      }
    }

    return buf.join("");
  }

  #tryToGuessDate(cFormat: string, cDate: string) {
    // We use the format to know the order of day, month, year, ...

    let actions = (this.#dateActionsCache ||= new Map()).get(cFormat);
    if (!actions) {
      actions = [];
      this.#dateActionsCache.set(cFormat, actions);
      cFormat.replaceAll(
        /(d+)|(m+)|(y+)|(H+)|(M+)|(s+)/g,
        function (_match, d, m, y, H, M, s) {
          if (d) {
            actions.push((n: number, date: Date) => {
              if (n >= 1 && n <= 31) {
                date.setDate(n);
                return true;
              }
              return false;
            });
          } else if (m) {
            actions.push((n: number, date: Date) => {
              if (n >= 1 && n <= 12) {
                date.setMonth(n - 1);
                return true;
              }
              return false;
            });
          } else if (y) {
            actions.push((n: number, date: Date) => {
              if (n < 50) {
                n += 2000;
              } else if (n < 100) {
                n += 1900;
              }
              // 这里从setYear改成了setFullYear
              // 因为Date对象的setYear应该已经被移除了
              date.setFullYear(n);
              return true;
            });
          } else if (H) {
            actions.push((n: number, date: Date) => {
              if (n >= 0 && n <= 23) {
                date.setHours(n);
                return true;
              }
              return false;
            });
          } else if (M) {
            actions.push((n: number, date: Date) => {
              if (n >= 0 && n <= 59) {
                date.setMinutes(n);
                return true;
              }
              return false;
            });
          } else if (s) {
            actions.push((n: number, date: Date) => {
              if (n >= 0 && n <= 59) {
                date.setSeconds(n);
                return true;
              }
              return false;
            });
          }
          return "";
        }
      );
    }

    const number = /\d+/g;
    let i = 0;
    let array;
    const date = new Date(0);
    while ((array = number.exec(cDate)) !== null) {
      if (i < actions.length) {
        if (!actions[i++](parseInt(array[0]), date)) {
          return null;
        }
      } else {
        break;
      }
    }

    if (i === 0) {
      return null;
    }

    return date;
  }

  scand(cFormat: string | 0 | 1 | 2, cDate: string | number | Date) {
    return this._scand(cFormat, cDate);
  }

  _scand(cFormat: string | 0 | 1 | 2, cDate: string | number | Date, strict = false): Date | null {
    if (typeof cDate !== "string") {
      return new Date(cDate);
    }

    if (cDate === "") {
      return new Date();
    }

    switch (cFormat) {
      case 0:
        return this.scand("D:yyyymmddHHMMss", cDate);
      case 1:
        return this.scand("yyyy.mm.dd HH:MM:ss", cDate);
      case 2:
        return this.scand("m/d/yy h:MM:ss tt", cDate);
    }

    if (!this._scandCache.has(cFormat)) {
      const months = this._months;
      const days = this._days;

      const handlers = {
        mmmm: {
          pattern: `(${months.join("|")})`,
          action: (value: string, data: { month: number }) => {
            data.month = months.indexOf(value);
          },
        },
        mmm: {
          pattern: `(${months.map(month => month.substring(0, 3)).join("|")})`,
          action: (value: string, data: { month: number }) => {
            data.month = months.findIndex(
              month => month.substring(0, 3) === value
            );
          },
        },
        mm: {
          pattern: `(\\d{2})`,
          action: (value: string, data: { month: number }) => {
            data.month = parseInt(value) - 1;
          },
        },
        m: {
          pattern: `(\\d{1,2})`,
          action: (value: string, data: { month: number }) => {
            data.month = parseInt(value) - 1;
          },
        },
        dddd: {
          pattern: `(${days.join("|")})`,
          action: (value: string, data: { day: number }) => {
            data.day = days.indexOf(value);
          },
        },
        ddd: {
          pattern: `(${days.map(day => day.substring(0, 3)).join("|")})`,
          action: (value: string, data: { day: number }) => {
            data.day = days.findIndex(day => day.substring(0, 3) === value);
          },
        },
        dd: {
          pattern: "(\\d{2})",
          action: (value: string, data: { day: number }) => {
            data.day = parseInt(value);
          },
        },
        d: {
          pattern: "(\\d{1,2})",
          action: (value: string, data: { day: number }) => {
            data.day = parseInt(value);
          },
        },
        yyyy: {
          pattern: "(\\d{4})",
          action: (value: string, data: { year: number }) => {
            data.year = parseInt(value);
          },
        },
        yy: {
          pattern: "(\\d{2})",
          action: (value: string, data: { year: number }) => {
            data.year = 2000 + parseInt(value);
          },
        },
        HH: {
          pattern: "(\\d{2})",
          action: (value: string, data: { hours: number }) => {
            data.hours = parseInt(value);
          },
        },
        H: {
          pattern: "(\\d{1,2})",
          action: (value: string, data: { hours: number }) => {
            data.hours = parseInt(value);
          },
        },
        hh: {
          pattern: "(\\d{2})",
          action: (value: string, data: { hours: number }) => {
            data.hours = parseInt(value);
          },
        },
        h: {
          pattern: "(\\d{1,2})",
          action: (value: string, data: { hours: number }) => {
            data.hours = parseInt(value);
          },
        },
        MM: {
          pattern: "(\\d{2})",
          action: (value: string, data: { minutes: number }) => {
            data.minutes = parseInt(value);
          },
        },
        M: {
          pattern: "(\\d{1,2})",
          action: (value: string, data: { minutes: number }) => {
            data.minutes = parseInt(value);
          },
        },
        ss: {
          pattern: "(\\d{2})",
          action: (value: string, data: { seconds: number }) => {
            data.seconds = parseInt(value);
          },
        },
        s: {
          pattern: "(\\d{1,2})",
          action: (value: string, data: { seconds: number }) => {
            data.seconds = parseInt(value);
          },
        },
        tt: {
          pattern: "([aApP][mM])",
          action: (value: string, data: { am: boolean }) => {
            const char = value.charAt(0);
            data.am = char === "a" || char === "A";
          },
        },
        t: {
          pattern: "([aApP])",
          action: (value: string, data: { am: boolean }) => {
            data.am = value === "a" || value === "A";
          },
        },
      };

      // escape the string
      const escapedFormat = cFormat.replaceAll(/[.*+\-?^${}()|[\]\\]/g, "\\$&");
      const patterns =
        /(mmmm|mmm|mm|m|dddd|ddd|dd|d|yyyy|yy|HH|H|hh|h|MM|M|ss|s|tt|t)/g;
      const actions = <((value: string, data: unknown) => void)[]>[];

      const re = escapedFormat.replaceAll(
        patterns,
        function (_match, patternElement: string) {
          const { pattern, action } = (handlers as any)[patternElement];
          actions.push(action);
          return pattern;
        }
      );

      this._scandCache.set(cFormat, [re, actions]);
    }

    const [re, actions] = this._scandCache.get(cFormat)!;

    const matches = new RegExp(`^${re}$`, "g").exec(cDate);
    if (!matches || matches.length !== actions.length + 1) {
      return strict ? null : this.#tryToGuessDate(cFormat, cDate);
    }

    const data = {
      year: 2000,
      month: 0,
      day: 1,
      hours: 0,
      minutes: 0,
      seconds: 0,
      am: null,
    };
    actions.forEach((action: (value: string, data: unknown) => void, i: number) => action(matches[i + 1], data));
    if (data.am !== null) {
      data.hours = (data.hours % 12) + (data.am ? 0 : 12);
    }

    return new Date(
      data.year,
      data.month,
      data.day,
      data.hours,
      data.minutes,
      data.seconds
    );
  }

  spansToXML() {
    /* Not implemented */
  }

  stringFromStream() {
    /* Not implemented */
  }

  xmlToSpans() {
    /* Not implemented */
  }
}

export { Util };
