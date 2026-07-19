/**
 * Perceptual hashing (8x8 average hash → 64-bit hex) + hamming distance on
 * hex strings. sharp is loaded dynamically so the API still runs (falling back
 * to client-provided hashes) if the native module is unavailable.
 */

type SharpModule = typeof import('sharp');

let sharpMod: SharpModule | null | undefined;

export async function getSharp(): Promise<SharpModule | null> {
  if (sharpMod !== undefined) return sharpMod;
  try {
    sharpMod = (await import('sharp')).default as unknown as SharpModule;
  } catch (err) {
    console.warn('[phash] sharp unavailable — falling back to client-provided phash:', (err as Error).message);
    sharpMod = null;
  }
  return sharpMod;
}

/**
 * Compute the 8x8 aHash of an image file as a 16-char lowercase hex string.
 * Returns null if sharp is unavailable or the file cannot be decoded.
 */
export async function aHashHex(absFilePath: string): Promise<string | null> {
  const sharp = await getSharp();
  if (!sharp) return null;
  try {
    const raw = await sharp(absFilePath)
      .greyscale()
      .resize(8, 8, { fit: 'fill' })
      .raw()
      .toBuffer();
    if (raw.length < 64) return null;
    let sum = 0;
    for (let i = 0; i < 64; i++) sum += raw[i];
    const avg = sum / 64;
    let bits = 0n;
    for (let i = 0; i < 64; i++) {
      bits = (bits << 1n) | (raw[i] >= avg ? 1n : 0n);
    }
    return bits.toString(16).padStart(16, '0');
  } catch (err) {
    console.warn('[phash] failed to hash image:', (err as Error).message);
    return null;
  }
}

const POPCOUNT_NIBBLE = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

/** Hamming distance between two hex-encoded hashes (case-insensitive). */
export function hammingHex(a: string, b: string): number {
  const ha = a.toLowerCase().replace(/^0x/, '');
  const hb = b.toLowerCase().replace(/^0x/, '');
  const len = Math.max(ha.length, hb.length);
  const pa = ha.padStart(len, '0');
  const pb = hb.padStart(len, '0');
  let dist = 0;
  for (let i = 0; i < len; i++) {
    const na = parseInt(pa[i], 16);
    const nb = parseInt(pb[i], 16);
    if (Number.isNaN(na) || Number.isNaN(nb)) return Number.MAX_SAFE_INTEGER;
    dist += POPCOUNT_NIBBLE[na ^ nb];
  }
  return dist;
}
