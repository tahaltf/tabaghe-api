export type GalleryOrderSlot =
  | { type: 'existing'; name: string }
  | { type: 'new'; fileIndex: number };

export type GalleryOrderSlotInput = {
  type: 'existing' | 'new';
  name?: string;
  fileIndex?: number;
};

export function resolveGalleryFromOrder(
  order: GalleryOrderSlotInput[],
  uploadedFileNames: string[],
): { gallery: string[]; thumbnail: string | null } {
  const gallery = order
    .map((slot) => {
      if (slot.type === 'existing' && slot.name) return slot.name;
      if (slot.type === 'new' && slot.fileIndex != null) {
        return uploadedFileNames[slot.fileIndex] ?? null;
      }
      return null;
    })
    .filter((name): name is string => !!name);

  return { gallery, thumbnail: gallery[0] ?? null };
}
