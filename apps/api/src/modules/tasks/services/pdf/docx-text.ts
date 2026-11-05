import { BadRequestException } from '@nestjs/common';
import { inflateRawSync } from 'node:zlib';

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function readZipEntry(input: Buffer, targetName: string): Buffer | null {
  const endSignature = 0x06054b50;
  let endOffset = -1;
  for (let i = input.length - 22; i >= 0; i--) {
    if (input.readUInt32LE(i) === endSignature) {
      endOffset = i;
      break;
    }
  }

  if (endOffset === -1) return null;

  const centralDirectoryOffset = input.readUInt32LE(endOffset + 16);
  let offset = centralDirectoryOffset;
  while (offset + 46 <= input.length) {
    if (input.readUInt32LE(offset) !== 0x02014b50) break;

    const compressionMethod = input.readUInt16LE(offset + 10);
    const compressedSize = input.readUInt32LE(offset + 20);
    const filenameLength = input.readUInt16LE(offset + 28);
    const extraLength = input.readUInt16LE(offset + 30);
    const commentLength = input.readUInt16LE(offset + 32);
    const localHeaderOffset = input.readUInt32LE(offset + 42);
    const filename = input
      .subarray(offset + 46, offset + 46 + filenameLength)
      .toString('utf8');

    if (filename === targetName) {
      if (
        localHeaderOffset + 30 > input.length ||
        input.readUInt32LE(localHeaderOffset) !== 0x04034b50
      ) {
        return null;
      }
      const localFilenameLength = input.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = input.readUInt16LE(localHeaderOffset + 28);
      const dataStart =
        localHeaderOffset + 30 + localFilenameLength + localExtraLength;
      const compressed = input.subarray(dataStart, dataStart + compressedSize);
      if (compressionMethod === 0) return compressed;
      if (compressionMethod === 8) return inflateRawSync(compressed);
      throw new BadRequestException(
        `Unsupported DOCX compression method: ${compressionMethod}`
      );
    }

    offset += 46 + filenameLength + extraLength + commentLength;
  }

  return null;
}

export function extractDocxPlainText(input: Buffer): string {
  const documentXml = readZipEntry(input, 'word/document.xml');
  if (!documentXml) {
    throw new BadRequestException('DOCX document body not found');
  }

  const xml = documentXml.toString('utf8');
  return (
    xml
      .replace(/<w:tab\b[^>]*\/>/g, '\t')
      .replace(/<w:br\b[^>]*\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .match(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|[\t\n]/g)
      ?.map(part => {
        if (part === '\t' || part === '\n') return part;
        const match = part.match(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/);
        return match ? decodeXmlText(match[1]!) : '';
      })
      .join('')
      .replace(/\n{3,}/g, '\n\n')
      .trim() ?? ''
  );
}
