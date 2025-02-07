import { AnnotationEditorType, info } from "../../shared/util";
import { IL10n } from "../../viewer/common/component_types";
import { FreeTextEditor } from "./freetext";
import { HighlightEditor } from "./highlight";
import { InkEditor } from "./ink";
import { StampEditor } from "./stamp";
import { AnnotationEditorUIManager } from "./tools";

interface AnnotationEditorDescriptor<T> {
  initialize: (l10n: IL10n, uiManager: AnnotationEditorUIManager) => void;
  create: () => T;
  type: AnnotationEditorType;
  name: string;
  canCreateNewEmptyEditor: boolean;
}

export class EditorManager {

  protected static annotationEditorDescriptorMap = new Map<AnnotationEditorType, AnnotationEditorDescriptor<unknown>>();

  static {
    this.registerEditor({
      initialize: FreeTextEditor.initialize,
      name: FreeTextEditor._type,
      type: AnnotationEditorType.FREETEXT,
      canCreateNewEmptyEditor: FreeTextEditor.canCreateNewEmptyEditor(),
      create: () => new FreeTextEditor(),
    });
    this.registerEditor({
      initialize: InkEditor.initialize,
      name: InkEditor._type,
      type: AnnotationEditorType.INK,
      canCreateNewEmptyEditor: InkEditor.canCreateNewEmptyEditor(),
      create: () => new InkEditor(),
    });
    this.registerEditor({
      initialize: StampEditor.initialize,
      name: StampEditor._type,
      type: AnnotationEditorType.STAMP,
      canCreateNewEmptyEditor: StampEditor.canCreateNewEmptyEditor(),
      create: () => new StampEditor(),
    });
    this.registerEditor({
      initialize: HighlightEditor.initialize,
      name: HighlightEditor._type,
      type: AnnotationEditorType.HIGHLIGHT,
      canCreateNewEmptyEditor: StampEditor.canCreateNewEmptyEditor(),
      create: () => new HighlightEditor(),
    });
  }

  static registerEditor(desc: AnnotationEditorDescriptor<unknown>) {
    if (this.annotationEditorDescriptorMap.has(desc.type)) {
      throw new Error("重复注册批注类型" + desc.type);
    }
    this.annotationEditorDescriptorMap.set(desc.type, desc);
  }

  static getL10nInitializer() {
    const initializers: ((l10n: IL10n, uiManager: AnnotationEditorUIManager) => void)[] = [];
    for (const descriptor of this.annotationEditorDescriptorMap.values()) {
      initializers.push(descriptor.initialize);
    }
    return initializers;
  }

  static getEditorBasicInfo() {
    const infos: { type: AnnotationEditorType, name: string }[] = []
    for (const descriptor of this.annotationEditorDescriptorMap.values()) {
      infos.push({ type: descriptor.type, name: descriptor.name });
    }
    return infos;
  }

  static getDescriptor(type: AnnotationEditorType) {
    return this.annotationEditorDescriptorMap.get(type) ?? null;
  }
}