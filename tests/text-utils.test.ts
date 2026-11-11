import { describe, it, expect } from 'vitest';
import { countGraphemes, truncateGraphemes, isRTL, generateFlowerCode, sanitizePlainMessage } from '../src/services/text-utils';

describe('Text & Unicode Utilities', () => {
  it('correctly counts standard Latin text', () => {
    expect(countGraphemes('Hello World')).toBe(11);
  });

  it('correctly counts multi-codepoint emojis and ZWJ sequences as single graphemes', () => {
    // Family emoji: man + ZWJ + woman + ZWJ + girl + ZWJ + boy
    const family = '👨‍👩‍👧‍👦';
    expect(countGraphemes(family)).toBe(1);

    // Person with skin tone modifier
    const wavingHand = '👋🏽';
    expect(countGraphemes(wavingHand)).toBe(1);

    // Combining accent e + acute accent
    const combining = 'e\u0301';
    expect(countGraphemes(combining)).toBe(1);
  });

  it('correctly truncates text to max graphemes without splitting characters', () => {
    const text = 'Hello 👋🏽🌸 World';
    const truncated = truncateGraphemes(text, 8);
    expect(countGraphemes(truncated)).toBe(8);
  });

  it('detects Right-to-Left scripts', () => {
    expect(isRTL('مرحبا بكم في الحديقة')).toBe(true); // Arabic
    expect(isRTL('שלום לכולם')).toBe(true); // Hebrew
    expect(isRTL('Hello world')).toBe(false); // English
    expect(isRTL('こんにちは世界')).toBe(false); // Japanese
  });

  it('generates unique FLW-XXXX codes with safe alphanumeric characters', () => {
    const code1 = generateFlowerCode(12345);
    const code2 = generateFlowerCode(67890);
    expect(code1).toMatch(/^FLW-[2-9A-HJ-NP-Z]{4}$/);
    expect(code2).toMatch(/^FLW-[2-9A-HJ-NP-Z]{4}$/);
  });

  it('sanitizes malicious control characters while preserving valid newlines', () => {
    const dirty = 'Line 1\x00\x08\nLine 2\x1F';
    const cleaned = sanitizePlainMessage(dirty);
    expect(cleaned).toBe('Line 1\nLine 2');
  });
});

