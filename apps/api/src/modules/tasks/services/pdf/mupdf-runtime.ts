export type MupdfModule = typeof import('mupdf');
const nativeImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string
) => Promise<MupdfModule>;
let mupdfPromise: Promise<MupdfModule> | undefined;

export function getMupdf(): Promise<MupdfModule> {
  mupdfPromise ??= nativeImport('mupdf');
  return mupdfPromise;
}
