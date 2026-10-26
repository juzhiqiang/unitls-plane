export const LOCAL_PROCESSING_MAX_BYTES = 5 * 1024 * 1024;

export function shouldProcessLocally(file: Pick<File, 'size'>): boolean {
  return file.size < LOCAL_PROCESSING_MAX_BYTES;
}
