import { MeshShadingPatternIR } from "./shading_types"
import { ImageMask } from "../image/image_types"
import { RadialAxialShadingIR } from "./shading_types"
import { FontExportData } from "./font_types"
import { FontExportExtraData } from "packages/seren-core/src/document/font/fonts"

export enum ObjType {
  Image = "Image",
  Pattern = "Pattern",
}

export enum CommonObjType {
  Font = "Font",
  Image = "Image",
  Pattern = "Pattern",
  FontPath = "FontPath",
  CopyLocalImage = "CopyLocalImage",
}

export interface ObjDataType {
  [ObjType.Pattern]: string[] | MeshShadingPatternIR | RadialAxialShadingIR,
  [ObjType.Image]: ImageMask | null,
}

export interface CommonObjDataType {
  [CommonObjType.Font]: FontExportData | FontExportExtraData | { error: string }
  [CommonObjType.Image]: ImageMask | null
  [CommonObjType.Pattern]: string[] | MeshShadingPatternIR | RadialAxialShadingIR
  [CommonObjType.FontPath]: number[]
  [CommonObjType.CopyLocalImage]: { imageRef: string }
}

