declare module 'wawoff2' {
  export function compress(input: Uint8Array | Buffer): Promise<Buffer>;
  export function decompress(input: Uint8Array | Buffer): Promise<Buffer>;

  const wawoff2: {
    compress: typeof compress;
    decompress: typeof decompress;
  };

  export default wawoff2;
}
