import { XFAAttributesObj, XFAObject } from "./xfa_object";

export interface Namespace {

  buildXFAObject(name: string, attributes: XFAAttributesObj): XFAObject | undefined;

}
