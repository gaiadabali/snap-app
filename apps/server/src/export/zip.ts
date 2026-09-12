/**
 * A minimal ZIP writer, store method only.
 *
 * Written rather than depended on, for one reason: everything that goes in a
 * tax pack is a JPEG, a PNG or a PDF, all of which are already compressed.
 * Deflating them again costs CPU and saves nothing — often a few bytes more —
 * so the only method this needs is STORE, and STORE is a format simple enough
 * to implement correctly in one screen and test exactly.
 *
 * The output is a standard ZIP: Explorer, Finder, `unzip` and every accounting
 * package open it. What it deliberately does NOT support is Zip64, so the
 * archive is capped below 4 GB — checked and refused rather than silently
 * producing a file that unzips to garbage.
 *
 * Format reference: PKWARE APPNOTE 6.3.x, sections 4.3.7 (local header),
 * 4.3.12 (central directory) and 4.3.16 (end of central directory).
 */

/** Maximum any offset or size may reach without Zip64. */
const FOUR_GB = 0xffff_ffff;

const SIG_LOCAL = 0x0403_4b50;
const SIG_CENTRAL = 0x0201_4b50;
const SIG_EOCD = 0x0605_4b50;

export type ZipEntry = { name: string; bytes: Buffer; modified?: Date };

/* ── CRC-32 ──────────────────────────────────────────────────────────────── */

/**
 * The table is built once, on first use. A ZIP without a correct CRC opens
 * fine in some tools and reports corruption in others, which is the worst of
 * both: the user finds out from their accountant.
 */
let CRC_TABLE: Int32Array | null = null;

function crcTable(): Int32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb8_8320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  CRC_TABLE = table;
  return table;
}

export function crc32(buf: Buffer): number {
  const table = crcTable();
  let c = -1; // 0xffffffff as a signed int
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* ── MS-DOS date and time ────────────────────────────────────────────────── */

/**
 * ZIP stores timestamps in the 1980 MS-DOS format, two seconds' resolution.
 * A date before 1980 cannot be represented at all, so it is clamped rather
 * than allowed to wrap into a nonsense year.
 */
function dosDateTime(d: Date): { date: number; time: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
  };
}

/* ── The archive ─────────────────────────────────────────────────────────── */

/**
 * Builds the whole archive in memory.
 *
 * In memory because a tax pack is a financial year of phone photographs —
 * tens of megabytes, not gigabytes — and because a streamed writer would have
 * to hold every central-directory record anyway. The 4 GB guard is what stops
 * that assumption becoming a silent corruption if it ever stops holding.
 */
export function zip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  const seen = new Set<string>();

  for (const entry of entries) {
    // A duplicate name produces an archive where one file silently shadows
    // another depending on the extractor. Names are ours to choose, so this is
    // a programming error, not a user one.
    if (seen.has(entry.name)) throw new Error(`zip: duplicate entry name ${entry.name}`);
    seen.add(entry.name);

    const name = Buffer.from(entry.name, 'utf8');
    const { date, time } = dosDateTime(entry.modified ?? new Date());
    const crc = crc32(entry.bytes);
    const size = entry.bytes.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0
    // Bit 11: the name is UTF-8. Without it a receipt from "Café Roma" opens
    // with a mangled filename on Windows.
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8); // method 0 = store
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18); // compressed
    local.writeUInt32LE(size, 22); // uncompressed — identical under STORE
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // no extra field

    const central = Buffer.alloc(46);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    central.writeUInt16LE(0x031e, 4); // made by: 3.0, Unix
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attributes
    // Unix mode 0100644 in the high 16 bits — a regular file, rw-r--r--.
    // `>>> 0` is not decoration: the shift alone overflows into a negative
    // number and `writeUInt32LE` throws rather than writing it.
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);

    locals.push(local, name, entry.bytes);
    centrals.push(central, name);
    offset += local.length + name.length + size;

    if (offset > FOUR_GB) {
      throw new Error('zip: archive exceeds 4 GB, which needs Zip64 (not implemented)');
    }
  }

  const centralBytes = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4); // this disk
  eocd.writeUInt16LE(0, 6); // disk with the central directory
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // no archive comment

  return Buffer.concat([...locals, centralBytes, eocd]);
}
