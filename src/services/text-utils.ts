/**
 * Robust Unicode and Internationalization text utilities.
 * Handles grapheme clusters (emoji combinations, zero-width joiners, skin tones, accents)
 * and bidirectional text detection.
 */

// Use Intl.Segmenter for true user-perceived character counting
const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;

/**
 * Counts user-perceived characters (grapheme clusters).
 * E.g., "👨‍👩‍👧‍👦" counts as 1 character, "é" with combining accent counts as 1 character.
 */
export function countGraphemes(text: string): number {
  if (!text) return 0;
  if (segmenter) {
    let count = 0;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const _ of segmenter.segment(text)) {
      count++;
    }
    return count;
  }
  // Fallback for environments lacking Intl.Segmenter
  return Array.from(text).length;
}

/**
 * Truncates text to max allowed graphemes cleanly.
 */
export function truncateGraphemes(text: string, maxGraphemes: number): string {
  if (!text) return '';
  if (segmenter) {
    let count = 0;
    let endIndex = 0;
    for (const segment of segmenter.segment(text)) {
      if (count >= maxGraphemes) break;
      endIndex = segment.index + segment.segment.length;
      count++;
    }
    return text.slice(0, endIndex);
  }
  return Array.from(text).slice(0, maxGraphemes).join('');
}

/**
 * Detects if text is primarily Right-to-Left (e.g. Arabic, Hebrew, Persian, Urdu).
 */
export function isRTL(text: string): boolean {
  if (!text) return false;
  // Common RTL Unicode ranges:
  // Arabic: \u0600-\u06FF, \u0750-\u077F, \u08A0-\u08FF, \uFB50-\uFDFF, \uFE70-\uFEFF
  // Hebrew: \u0590-\u05FF, \uFB1D-\uFB4F
  const rtlRegex = /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/;
  return rtlRegex.test(text);
}

/**
 * Generates an 8-character unique alphanumeric flower code e.g. "FLW-7X9K".
 * Excludes easily confusable characters (0, O, 1, I, L).
 */
export function generateFlowerCode(seed: number = Date.now()): string {
  const chars = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  let hash = Math.abs(seed);
  let code = 'FLW-';
  for (let i = 0; i < 4; i++) {
    const idx = (hash + i * 31 + (Date.now() % 17)) % chars.length;
    code += chars[idx];
    hash = Math.floor(hash / chars.length) ^ (i * 97);
  }
  return code;
}

/**
 * Sanitizes plain text input: removes control chars while preserving newlines and unicode.
 */
export function sanitizePlainMessage(input: string): string {
  if (!input) return '';
  // Strip null bytes and non-printable control characters except newline and tab
  return input
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim();
}

