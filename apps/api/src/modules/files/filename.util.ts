const REPLACEMENT_CHARACTER = '\uFFFD';

function suspiciousCharacterCount(value: string): number {
  return Array.from(value).filter(char =>
    /[\u0080-\u009f\u00c0-\u00ff]/.test(char)
  ).length;
}

export function normalizeUploadedFilename(filename: string): string {
  try {
    const repaired = Buffer.from(filename, 'latin1').toString('utf8');
    if (repaired.includes(REPLACEMENT_CHARACTER)) return filename;

    return suspiciousCharacterCount(repaired) <
      suspiciousCharacterCount(filename)
      ? repaired
      : filename;
  } catch {
    return filename;
  }
}
