const UNICODE_NFC_NORMALIZATION_FORM = "NFC";

/** Return the canonical Unicode representation used for new item names. */
export function canonicalizeItemName(name: string): string {
  return name.normalize(UNICODE_NFC_NORMALIZATION_FORM);
}
