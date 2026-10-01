/**
 * RFC 9562 UUIDv7: 48-bit Unix-ms timestamp + version + random bits.
 * Time-sortable and safe to generate offline (extension queue, collector spool).
 */
export function uuidv7(nowMs: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // 48-bit big-endian timestamp in bytes 0..5.
  let ts = nowMs;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ts & 0xff;
    ts = Math.floor(ts / 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Extracts the embedded millisecond timestamp from a UUIDv7. */
export function uuidv7Timestamp(id: string): number {
  return parseInt(id.replace(/-/g, '').slice(0, 12), 16);
}
