import { inflateRawSync } from 'node:zlib';

const MAX_XML_BYTES = 30 * 1024 * 1024;
const MAX_XML_FILES = 4096;
const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

/**
 * The API produces ordinary ZIPs containing flat XML names, with no encryption,
 * data descriptors or ZIP64. Verify every byte/size/CRC before saving the ZIP;
 * a central-directory size must never be used to truncate inflated output.
 */
export function readPolicyZip(bytes: Buffer): Buffer[] {
  const invalid = () => new Error('Invalid or unsafe WDAC archive.');
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0 || bytes.readUInt32LE(end) !== 0x06054b50 ||
      end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length ||
      bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0) throw invalid();
  const count = bytes.readUInt16LE(end + 10);
  let cursor = bytes.readUInt32LE(end + 16);
  const centralStart = cursor;
  if (!count || count > MAX_XML_FILES || bytes.readUInt16LE(end + 8) !== count ||
      cursor + bytes.readUInt32LE(end + 12) !== end) throw invalid();
  const names = new Set<string>();
  const files: Buffer[] = [];
  let actualTotal = 0, localOffset = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) throw invalid();
    const flags = bytes.readUInt16LE(cursor + 8), compression = bytes.readUInt16LE(cursor + 10);
    const crc = bytes.readUInt32LE(cursor + 16), compressed = bytes.readUInt32LE(cursor + 20);
    const original = bytes.readUInt32LE(cursor + 24), nameSize = bytes.readUInt16LE(cursor + 28);
    const next = cursor + 46 + nameSize + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32);
    const offset = bytes.readUInt32LE(cursor + 42);
    if (next > end || flags & ~0x0800 || ![0, 8].includes(compression) ||
        bytes.readUInt16LE(cursor + 34) !== 0 || offset !== localOffset || original < 1 ||
        original > MAX_XML_BYTES - actualTotal) throw invalid();
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameSize);
    const name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
    if (!/^[a-zA-Z0-9_-]+\.xml$/.test(name) || names.has(name.toLowerCase())) throw invalid();
    names.add(name.toLowerCase());
    if (offset + 30 > centralStart || bytes.readUInt32LE(offset) !== 0x04034b50 ||
        bytes.readUInt16LE(offset + 6) !== flags || bytes.readUInt16LE(offset + 8) !== compression ||
        bytes.readUInt32LE(offset + 14) !== crc || bytes.readUInt32LE(offset + 18) !== compressed ||
        bytes.readUInt32LE(offset + 22) !== original || bytes.readUInt16LE(offset + 26) !== nameSize ||
        !bytes.subarray(offset + 30, offset + 30 + nameSize).equals(nameBytes)) throw invalid();
    const start = offset + 30 + nameSize + bytes.readUInt16LE(offset + 28);
    localOffset = start + compressed;
    if (localOffset > centralStart) throw invalid();
    const compressedBytes = bytes.subarray(start, localOffset);
    const xml = compression === 0 ? compressedBytes : inflateRawSync(compressedBytes, {
      maxOutputLength: MAX_XML_BYTES - actualTotal,
    });
    if (xml.length !== original || crc32(xml) !== crc) throw invalid();
    actualTotal += xml.length;
    files.push(xml);
    cursor = next;
  }
  if (cursor !== end || localOffset !== centralStart) throw invalid();
  return files;
}
