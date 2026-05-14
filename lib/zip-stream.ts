export type ZipStreamEntry = {
  chunks: Iterable<Uint8Array>;
  fileName: string;
  modifiedAt: string | Date;
};

type CentralDirectoryEntry = {
  compressedSize: number;
  crc32: number;
  dosDate: number;
  dosTime: number;
  fileNameBytes: Uint8Array;
  localHeaderOffset: number;
  uncompressedSize: number;
};

const textEncoder = new TextEncoder();
const zipFlagUtf8WithDescriptor = 0x0808;
const zipStoreMethod = 0;
const crc32Table = createCrc32Table();

function createCrc32Table() {
  const table = new Uint32Array(256);

  for (let index = 0; index < table.length; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
}

function updateCrc32(crc: number, chunk: Uint8Array) {
  let value = crc;

  for (const byte of chunk) {
    value = crc32Table[(value ^ byte) & 0xff] ^ (value >>> 8);
  }

  return value >>> 0;
}

function writeUint16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value & 0xffff, true);
}

function writeUint32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
}

function toDosDateTime(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const year = Math.max(1980, safeDate.getFullYear());
  const dosTime =
    (safeDate.getHours() << 11) |
    (safeDate.getMinutes() << 5) |
    Math.floor(safeDate.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((safeDate.getMonth() + 1) << 5) | safeDate.getDate();

  return { dosDate, dosTime };
}

function buildLocalHeader(fileNameBytes: Uint8Array, dosTime: number, dosDate: number) {
  const header = new Uint8Array(30 + fileNameBytes.byteLength);
  const view = new DataView(header.buffer);

  writeUint32(view, 0, 0x04034b50);
  writeUint16(view, 4, 20);
  writeUint16(view, 6, zipFlagUtf8WithDescriptor);
  writeUint16(view, 8, zipStoreMethod);
  writeUint16(view, 10, dosTime);
  writeUint16(view, 12, dosDate);
  writeUint32(view, 14, 0);
  writeUint32(view, 18, 0);
  writeUint32(view, 22, 0);
  writeUint16(view, 26, fileNameBytes.byteLength);
  writeUint16(view, 28, 0);
  header.set(fileNameBytes, 30);

  return header;
}

function buildDataDescriptor(crc32: number, compressedSize: number, uncompressedSize: number) {
  const descriptor = new Uint8Array(16);
  const view = new DataView(descriptor.buffer);

  writeUint32(view, 0, 0x08074b50);
  writeUint32(view, 4, crc32);
  writeUint32(view, 8, compressedSize);
  writeUint32(view, 12, uncompressedSize);

  return descriptor;
}

function buildCentralDirectoryHeader(entry: CentralDirectoryEntry) {
  const header = new Uint8Array(46 + entry.fileNameBytes.byteLength);
  const view = new DataView(header.buffer);

  writeUint32(view, 0, 0x02014b50);
  writeUint16(view, 4, 20);
  writeUint16(view, 6, 20);
  writeUint16(view, 8, zipFlagUtf8WithDescriptor);
  writeUint16(view, 10, zipStoreMethod);
  writeUint16(view, 12, entry.dosTime);
  writeUint16(view, 14, entry.dosDate);
  writeUint32(view, 16, entry.crc32);
  writeUint32(view, 20, entry.compressedSize);
  writeUint32(view, 24, entry.uncompressedSize);
  writeUint16(view, 28, entry.fileNameBytes.byteLength);
  writeUint16(view, 30, 0);
  writeUint16(view, 32, 0);
  writeUint16(view, 34, 0);
  writeUint16(view, 36, 0);
  writeUint32(view, 38, 0);
  writeUint32(view, 42, entry.localHeaderOffset);
  header.set(entry.fileNameBytes, 46);

  return header;
}

function buildEndOfCentralDirectory(
  entryCount: number,
  centralDirectorySize: number,
  centralDirectoryOffset: number,
) {
  const header = new Uint8Array(22);
  const view = new DataView(header.buffer);

  writeUint32(view, 0, 0x06054b50);
  writeUint16(view, 4, 0);
  writeUint16(view, 6, 0);
  writeUint16(view, 8, entryCount);
  writeUint16(view, 10, entryCount);
  writeUint32(view, 12, centralDirectorySize);
  writeUint32(view, 16, centralDirectoryOffset);
  writeUint16(view, 20, 0);

  return header;
}

async function* generateZip(entries: AsyncIterable<ZipStreamEntry>) {
  const centralDirectoryEntries: CentralDirectoryEntry[] = [];
  let offset = 0;

  for await (const entry of entries) {
    const fileNameBytes = textEncoder.encode(entry.fileName);
    const { dosDate, dosTime } = toDosDateTime(entry.modifiedAt);
    const localHeaderOffset = offset;
    const localHeader = buildLocalHeader(fileNameBytes, dosTime, dosDate);
    let crc32 = 0xffffffff;
    let size = 0;

    yield localHeader;
    offset += localHeader.byteLength;

    for (const chunk of entry.chunks) {
      crc32 = updateCrc32(crc32, chunk);
      size += chunk.byteLength;
      yield chunk;
      offset += chunk.byteLength;
    }

    const finalCrc32 = (crc32 ^ 0xffffffff) >>> 0;
    const descriptor = buildDataDescriptor(finalCrc32, size, size);
    yield descriptor;
    offset += descriptor.byteLength;

    centralDirectoryEntries.push({
      compressedSize: size,
      crc32: finalCrc32,
      dosDate,
      dosTime,
      fileNameBytes,
      localHeaderOffset,
      uncompressedSize: size,
    });
  }

  const centralDirectoryOffset = offset;

  for (const entry of centralDirectoryEntries) {
    const header = buildCentralDirectoryHeader(entry);
    yield header;
    offset += header.byteLength;
  }

  const centralDirectorySize = offset - centralDirectoryOffset;
  yield buildEndOfCentralDirectory(
    centralDirectoryEntries.length,
    centralDirectorySize,
    centralDirectoryOffset,
  );
}

export function createZipStream(entries: AsyncIterable<ZipStreamEntry>) {
  const iterator = generateZip(entries);

  return new ReadableStream<Uint8Array>({
    async cancel() {
      await iterator.return(undefined);
    },
    async pull(controller) {
      const { done, value } = await iterator.next();

      if (done) {
        controller.close();
        return;
      }

      controller.enqueue(value);
    },
  });
}
