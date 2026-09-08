'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Brush, Square, Undo2, Eraser } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';

/** 一笔(可撤销的最小单位):画笔轨迹或矩形圈选。 */
type Stroke =
  | { type: 'brush'; size: number; points: Array<{ x: number; y: number }> }
  | { type: 'rect'; x: number; y: number; width: number; height: number };

export interface MaskEditorSubmitPayload {
  /** 蒙版 PNG:透明区 = 要重绘的区域(OpenAI 语义),与原图同尺寸。 */
  maskBlob: Blob;
  prompt: string;
  width: number;
  height: number;
}

interface MaskEditorProps {
  open: boolean;
  /** 要编辑的原图(blob url)。 */
  imageUrl: string;
  onClose: () => void;
  onSubmit: (payload: MaskEditorSubmitPayload) => void;
  busy?: boolean;
}

/**
 * 局部重绘蒙版编辑器:画笔涂抹或矩形圈选标记重绘区域。
 *
 * - 每一笔(一次涂抹/一个矩形)是一个可撤销步骤,撤销弹栈、清空归零;
 * - 显示层用半透明红色描出选区,导出层用 destination-out 在白底上挖出透明区;
 * - canvas 内部尺寸 = 原图原始尺寸,蒙版与原图逐像素对齐(mask 尺寸必须与原图一致)。
 */
export function MaskEditor({
  open,
  imageUrl,
  onClose,
  onSubmit,
  busy = false,
}: MaskEditorProps) {
  const t = useTranslations('ImageGenerate');
  const [tool, setTool] = useState<'brush' | 'rect'>('brush');
  const [brushSize, setBrushSize] = useState(24);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [prompt, setPrompt] = useState('');
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  // 正在画的那一笔:未提交前不进 strokes,这样"步骤撤销"的粒度就是完整的一笔。
  const drawingRef = useRef<Stroke | null>(null);

  /** 把一笔画到 ctx。display=true 用半透明红;false 时假定 ctx 已配置 destination-out。 */
  const drawStroke = useCallback(
    (ctx: CanvasRenderingContext2D, stroke: Stroke, display: boolean) => {
      if (display) {
        ctx.fillStyle = 'rgba(239,68,68,0.45)';
        ctx.strokeStyle = 'rgba(239,68,68,0.45)';
      }
      if (stroke.type === 'brush') {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = stroke.size;
        ctx.beginPath();
        stroke.points.forEach((point, index) => {
          if (index === 0) ctx.moveTo(point.x, point.y);
          else ctx.lineTo(point.x, point.y);
        });
        // 单点也要能画出来(点一下 = 一个圆点)。
        const single = stroke.points[0];
        if (stroke.points.length === 1 && single) {
          ctx.arc(single.x, single.y, stroke.size / 2, 0, Math.PI * 2);
          ctx.fill();
          return;
        }
        ctx.stroke();
      } else {
        ctx.fillRect(stroke.x, stroke.y, stroke.width, stroke.height);
      }
    },
    []
  );

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const all = drawingRef.current
      ? [...strokes, drawingRef.current]
      : strokes;
    for (const stroke of all) drawStroke(ctx, stroke, true);
  }, [strokes, drawStroke]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  const toCanvasPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const handlePointerDown = (
    event: React.PointerEvent<HTMLCanvasElement>
  ) => {
    if (busy) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toCanvasPoint(event);
    drawingRef.current =
      tool === 'brush'
        ? { type: 'brush', size: brushSize, points: [point] }
        : { type: 'rect', x: point.x, y: point.y, width: 0, height: 0 };
    redraw();
  };

  const handlePointerMove = (
    event: React.PointerEvent<HTMLCanvasElement>
  ) => {
    const current = drawingRef.current;
    if (!current) return;
    const point = toCanvasPoint(event);
    if (current.type === 'brush') {
      current.points.push(point);
    } else {
      current.width = point.x - current.x;
      current.height = point.y - current.y;
    }
    redraw();
  };

  const handlePointerUp = () => {
    const current = drawingRef.current;
    if (!current) return;
    drawingRef.current = null;
    // 矩形从右下往左上拖时宽高为负,归一化。
    if (current.type === 'rect') {
      current.x = Math.min(current.x, current.x + current.width);
      current.y = Math.min(current.y, current.y + current.height);
      current.width = Math.abs(current.width);
      current.height = Math.abs(current.height);
    }
    setStrokes(previous => [...previous, current]);
  };

  const undo = () => setStrokes(previous => previous.slice(0, -1));

  // Ctrl/Cmd+Z 撤销一步:编辑器的核心交互,除了按钮还要给键盘快捷键。
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        setStrokes(previous => previous.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const submit = async () => {
    if (strokes.length === 0 || prompt.trim().length === 0) return;
    const { width, height } = imageSize;
    if (!width || !height) return;

    // 导出蒙版:白底不透明,选区用 destination-out 挖成透明(= 重绘区域)。
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = width;
    exportCanvas.height = height;
    const ctx = exportCanvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'destination-out';
    for (const stroke of strokes) drawStroke(ctx, stroke, false);

    const maskBlob = await new Promise<Blob | null>(resolve =>
      exportCanvas.toBlob(resolve, 'image/png')
    );
    if (!maskBlob) return;

    onSubmit({ maskBlob, prompt: prompt.trim(), width, height });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent
        closeLabel={t('editorClose')}
        className="flex max-h-[92vh] max-w-[92vw] flex-col gap-3 overflow-y-auto p-4 lg:max-w-3xl"
      >
        <DialogTitle className="text-sm font-medium">
          {t('editorTitle')}
        </DialogTitle>

        {/* 工具栏:画笔/矩形 + 笔刷大小 + 撤销/清空。 */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={tool === 'brush'}
            onClick={() => setTool('brush')}
            className={`flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs ${
              tool === 'brush'
                ? 'border-foreground bg-foreground text-background'
                : 'border-border hover:border-foreground'
            }`}
          >
            <Brush className="h-3.5 w-3.5" />
            {t('editorBrush')}
          </button>
          <button
            type="button"
            aria-pressed={tool === 'rect'}
            onClick={() => setTool('rect')}
            className={`flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs ${
              tool === 'rect'
                ? 'border-foreground bg-foreground text-background'
                : 'border-border hover:border-foreground'
            }`}
          >
            <Square className="h-3.5 w-3.5" />
            {t('editorRect')}
          </button>
          {tool === 'brush' && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              {t('editorBrushSize')}
              <input
                type="range"
                min={4}
                max={96}
                value={brushSize}
                onChange={event => setBrushSize(Number(event.target.value))}
                className="w-28"
              />
            </label>
          )}
          <span className="flex-1" />
          <button
            type="button"
            onClick={undo}
            disabled={strokes.length === 0 || busy}
            className="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs hover:border-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Undo2 className="h-3.5 w-3.5" />
            {t('editorUndo')}
          </button>
          <button
            type="button"
            onClick={() => setStrokes([])}
            disabled={strokes.length === 0 || busy}
            className="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs hover:border-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Eraser className="h-3.5 w-3.5" />
            {t('editorClear')}
          </button>
        </div>

        {/* 画布:原图在下,蒙版层在上,尺寸对齐原图。 */}
        <div className="relative mx-auto max-h-[52vh] w-fit overflow-auto rounded-md border border-border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imageRef}
            src={imageUrl}
            alt={t('editorImageAlt')}
            onLoad={event => {
              const img = event.currentTarget;
              setImageSize({
                width: img.naturalWidth,
                height: img.naturalHeight,
              });
            }}
            className="block max-w-full select-none"
            draggable={false}
          />
          <canvas
            ref={canvasRef}
            width={imageSize.width || 1}
            height={imageSize.height || 1}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
          />
        </div>

        <div className="flex items-end gap-2">
          <textarea
            value={prompt}
            onChange={event => setPrompt(event.target.value)}
            placeholder={t('editorPromptPlaceholder')}
            rows={2}
            maxLength={5000}
            className="min-h-9 flex-1 resize-none rounded-md border border-border bg-background p-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={
              busy || strokes.length === 0 || prompt.trim().length === 0
            }
            className="h-9 shrink-0 rounded-lg bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? t('generating') : t('editorSubmit')}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">{t('editorHint')}</p>
      </DialogContent>
    </Dialog>
  );
}
