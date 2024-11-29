import { XFAObject } from "./xfa_object";

export interface Namespace {
  buildXFAObject(name: string, attributes): XFAObject | undefined;
}
