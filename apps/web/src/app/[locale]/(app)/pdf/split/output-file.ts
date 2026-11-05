function outputBaseName(sourceFilename: string): string {
  const filename = sourceFilename.split(/[\\/]/).pop() ?? 'pdf';
  const base = filename.replace(/\.pdf$/i, '');
  return base || 'pdf';
}

async function hasSignature(
  blob: Blob,
  signature: readonly number[]
): Promise<boolean> {
  const bytes = new Uint8Array(
    await blob.slice(0, signature.length).arrayBuffer()
  );
  return signature.every((byte, index) => bytes[index] === byte);
}

export async function createSplitOutputFile(
  blob: Blob,
  sourceFilename: string
): Promise<File> {
  const base = outputBaseName(sourceFilename);
  const [isZip, isPdf] = await Promise.all([
    blob.type === 'application/zip' ||
      hasSignature(blob, [0x50, 0x4b, 0x03, 0x04]),
    blob.type === 'application/pdf' ||
      hasSignature(blob, [0x25, 0x50, 0x44, 0x46, 0x2d]),
  ]);

  if (isZip) {
    return new File([blob], `split-${base}.zip`, {
      type: 'application/zip',
    });
  }
  if (isPdf) {
    return new File([blob], `split-${base}.pdf`, {
      type: 'application/pdf',
    });
  }

  throw new Error('Unsupported split output format');
}
