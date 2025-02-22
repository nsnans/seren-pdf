export interface WebThumbnailViewService {

  forceRendering(): void;
}

export class GenericWebThumbnailViewService implements WebThumbnailViewService {
  forceRendering(): void {
    throw new Error("Method not implemented.");
  }

}
