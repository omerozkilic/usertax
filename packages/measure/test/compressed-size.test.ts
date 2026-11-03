import { describe, expect, it } from 'vitest';
import { compressedSize } from '@usertax/measure';

describe('compressedSize', () => {
  it('counts UTF-8 bytes for strings', () => {
    expect(compressedSize('ğüşıöç').raw).toBe(12);
  });

  it('compresses repetitive content well below its raw size', () => {
    const size = compressedSize('export const a = 1;\n'.repeat(1000));
    expect(size.raw).toBe(20_000);
    expect(size.gzip).toBeLessThan(size.raw / 10);
    expect(size.brotli).toBeLessThan(size.raw / 10);
  });

  it('accepts binary input', () => {
    const size = compressedSize(new Uint8Array([1, 2, 3, 4]));
    expect(size.raw).toBe(4);
    expect(size.gzip).toBeGreaterThan(0);
    expect(size.brotli).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    const input = 'function x(){return 42}'.repeat(50);
    expect(compressedSize(input)).toEqual(compressedSize(input));
  });
});
