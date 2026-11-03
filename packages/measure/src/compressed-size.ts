import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

/** Raw and compressed byte counts of one file. */
export interface CompressedSize {
  readonly raw: number;
  readonly gzip: number;
  readonly brotli: number;
}

/**
 * Measures what a file costs over the wire.
 *
 * gzip runs at level 9 and brotli at quality 11, the settings static hosts and CDNs use
 * for pre-compressed assets. Runtime-compressed responses are often larger; the report
 * states which settings were used so the numbers stay reproducible.
 */
export function compressedSize(content: Uint8Array | string): CompressedSize {
  const buffer = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
  return {
    raw: buffer.byteLength,
    gzip: gzipSync(buffer, { level: 9 }).byteLength,
    brotli: brotliCompressSync(buffer, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 11,
        [constants.BROTLI_PARAM_SIZE_HINT]: buffer.byteLength,
      },
    }).byteLength,
  };
}

/** Compression settings recorded in every report. */
export const COMPRESSION_SETTINGS = { gzipLevel: 9, brotliQuality: 11 } as const;
