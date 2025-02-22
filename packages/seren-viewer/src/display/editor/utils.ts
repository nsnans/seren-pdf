interface BitmapOwner {
  bitmap: ImageBitmap;
}
export function hasOwnBitmap(bitmap: any): bitmap is BitmapOwner {
  return 'bitmap' in bitmap;
}