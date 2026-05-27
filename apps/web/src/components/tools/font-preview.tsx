'use client';

import { useEffect, useRef, useState } from 'react';
import {
  loadFontAsCSS,
  loadFontInfo,
  loadFontGlyphs,
  unloadFont,
  type FontInfo,
  type GlyphInfo,
} from '@/lib/processing/font-client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';

interface FontPreviewProps {
  file: File;
}

export function FontPreview({ file }: FontPreviewProps) {
  const [fontFamily, setFontFamily] = useState<string | null>(null);
  const [info, setInfo] = useState<FontInfo | null>(null);
  const [glyphs, setGlyphs] = useState<GlyphInfo[]>([]);
  const [previewText, setPreviewText] = useState(
    'The quick brown fox jumps over the lazy dog\n敏捷的棕色狐狸跳过了懒狗\n0123456789 !@#$%^&*()'
  );
  const [fontSize, setFontSize] = useState(36);
  const [hoveredGlyph, setHoveredGlyph] = useState<GlyphInfo | null>(null);
  const fontFamilyRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;

    (async () => {
      const [name, fontInfo, fontGlyphs] = await Promise.all([
        loadFontAsCSS(file),
        loadFontInfo(file),
        loadFontGlyphs(file),
      ]);
      if (!active) return;
      setFontFamily(name);
      fontFamilyRef.current = name;
      setInfo(fontInfo);
      setGlyphs(fontGlyphs);
    })();

    return () => {
      active = false;
      if (fontFamilyRef.current) {
        unloadFont(fontFamilyRef.current);
      }
    };
  }, [file]);

  return (
    <div className="space-y-6">
      {info && (
        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-sm tracking-wider uppercase">
              {info.fullName}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
              <div>
                <span className="block font-mono text-[11px] tracking-wider uppercase text-muted-foreground">
                  Font Family
                </span>
                <span className="text-sm mt-1 block">{info.fontFamily}</span>
              </div>
              <div>
                <span className="block font-mono text-[11px] tracking-wider uppercase text-muted-foreground">
                  Style
                </span>
                <span className="text-sm mt-1 block">{info.fontSubfamily}</span>
              </div>
              <div>
                <span className="block font-mono text-[11px] tracking-wider uppercase text-muted-foreground">
                  Glyphs
                </span>
                <span className="text-sm mt-1 block font-mono">
                  {info.glyphCount}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="font-mono text-[11px] tracking-wider uppercase text-muted-foreground">
            Preview
          </label>
          <span className="font-mono text-[11px] text-muted-foreground">
            {fontSize}px
          </span>
        </div>
        <Slider
          value={fontSize}
          min={12}
          max={96}
          step={1}
          onChange={setFontSize}
        />
      </div>

      <div className="border border-border rounded-md">
        <textarea
          value={previewText}
          onChange={(e) => setPreviewText(e.target.value)}
          className="w-full bg-transparent border-b border-border px-4 py-3 text-sm resize-none focus:outline-none focus:border-accent placeholder:text-muted-foreground"
          rows={2}
          placeholder="Type preview text..."
        />
        <div
          className="px-4 sm:px-8 py-8 sm:py-12 whitespace-pre-wrap break-words min-h-[160px]"
          style={{
            fontFamily: fontFamily ?? 'inherit',
            fontSize: `${fontSize}px`,
            lineHeight: 1.4,
          }}
        >
          {previewText}
        </div>
      </div>

      {glyphs.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] tracking-wider uppercase text-muted-foreground">
              Glyph Map
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {hoveredGlyph
                ? `U+${hoveredGlyph.unicode.toString(16).toUpperCase().padStart(4, '0')}`
                : `${glyphs.length} glyphs`}
            </span>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-0">
            {glyphs.slice(0, 128).map((g) => (
              <div
                key={g.index}
                className="aspect-square border border-border flex items-center justify-center text-lg cursor-default transition-colors hover:bg-muted hover:border-accent/50"
                style={{ fontFamily: fontFamily ?? 'inherit' }}
                onMouseEnter={() => setHoveredGlyph(g)}
                onMouseLeave={() => setHoveredGlyph(null)}
                title={`U+${g.unicode.toString(16).toUpperCase().padStart(4, '0')} ${g.name}`}
              >
                {String.fromCodePoint(g.unicode)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
