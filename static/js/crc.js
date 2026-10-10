// CRC-32 (same algorithm as the standalone work page).
let T;
export function crc32(str) {
  T ||= Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  let c = -1; for (const b of new TextEncoder().encode(str)) c = (c >>> 8) ^ T[(c ^ b) & 255];
  return ((c ^ -1) >>> 0).toString(16).padStart(8, '0');
}
