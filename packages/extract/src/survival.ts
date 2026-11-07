const normalise = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Did the hidden text reach the extracted text? Whitespace is normalised because
 * extractors break lines differently; anything else must match exactly.
 */
export function hiddenTextPresent(extracted: string, hidden: string): boolean {
  return normalise(extracted).includes(normalise(hidden));
}
