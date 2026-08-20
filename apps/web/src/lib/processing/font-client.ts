import * as opentype from 'opentype.js';

export interface FontInfo {
  fontFamily: string;
  fontSubfamily: string;
  fullName: string;
  glyphCount: number;
  unitsPerEm: number;
}

export interface GlyphInfo {
  index: number;
  unicode: number;
  name: string;
}

export async function loadFontInfo(file: File): Promise<FontInfo> {
  const buffer = await file.arrayBuffer();
  const font = opentype.parse(buffer);
  return {
    fontFamily: font.names.fontFamily?.en ?? 'Unknown',
    fontSubfamily: font.names.fontSubfamily?.en ?? 'Regular',
    fullName: font.names.fullName?.en ?? 'Unknown',
    glyphCount: font.glyphs.length,
    unitsPerEm: font.unitsPerEm,
  };
}

export async function loadFontGlyphs(file: File): Promise<GlyphInfo[]> {
  const buffer = await file.arrayBuffer();
  const font = opentype.parse(buffer);
  const glyphs: GlyphInfo[] = [];

  for (let i = 0; i < font.glyphs.length; i++) {
    const glyph = font.glyphs.get(i);
    if (glyph.unicode !== undefined && glyph.unicode > 0) {
      glyphs.push({
        index: i,
        unicode: glyph.unicode,
        name: glyph.name ?? '',
      });
    }
  }

  return glyphs;
}

export async function loadFontAsCSS(file: File): Promise<string> {
  const fontName = `preview-font-${Date.now()}`;
  const url = URL.createObjectURL(file);

  const fontFace = new FontFace(fontName, `url(${url})`);
  await fontFace.load();
  document.fonts.add(fontFace);

  return fontName;
}

export function unloadFont(fontFamily: string) {
  document.fonts.forEach(f => {
    if (f.family === fontFamily) document.fonts.delete(f);
  });
}
