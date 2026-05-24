'use client';

import { useState, useEffect, useRef } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, X } from 'lucide-react';
import { loadPdf, renderPdfPage } from '@/lib/processing/pdf-client';
import { cn } from '@/lib/utils';

export interface SortableFile {
  id: string;
  file: File;
}

interface SortableFileListProps {
  files: SortableFile[];
  onReorder: (files: SortableFile[]) => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
}

function PdfThumbnail({ file }: { file: File }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const pdf = await loadPdf(file);
        if (cancelled || !canvasRef.current) return;
        await renderPdfPage(pdf, 1, 0.2, canvasRef.current);
        if (cancelled) return;
        setLoaded(true);
      } catch {
        // non-PDF or corrupt file
      }
    }

    render();
    return () => { cancelled = true; };
  }, [file]);

  return (
    <div className="relative w-10 h-14 border border-border bg-muted/30 flex items-center justify-center overflow-hidden">
      <canvas
        ref={canvasRef}
        className={cn(
          'w-full h-full object-contain',
          !loaded && 'invisible',
        )}
      />
      {!loaded && (
        <span className="absolute text-[9px] font-mono text-muted-foreground">PDF</span>
      )}
    </div>
  );
}

function SortableItem({
  item,
  index,
  onRemove,
  disabled,
}: {
  item: SortableFile;
  index: number;
  onRemove: (index: number) => void;
  disabled?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-3 px-3 py-2 border-b border-border bg-background',
        'transition-colors',
        isDragging && 'opacity-40 border border-dashed border-accent bg-transparent',
      )}
    >
      <button
        type="button"
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" strokeWidth={1} />
      </button>

      <PdfThumbnail file={item.file} />

      <div className="flex-1 min-w-0">
        <p className="text-xs font-mono truncate text-foreground">
          {item.file.name}
        </p>
        <p className="text-[10px] font-mono text-muted-foreground tabular-nums">
          {(item.file.size / 1024).toFixed(0)} KB
        </p>
      </div>

      <span className="text-[10px] font-mono text-muted-foreground tabular-nums w-6 text-right">
        {String(index + 1).padStart(2, '0')}
      </span>

      <button
        type="button"
        onClick={() => onRemove(index)}
        disabled={disabled}
        className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30"
      >
        <X className="h-3.5 w-3.5" strokeWidth={1.5} />
      </button>
    </div>
  );
}

export function SortableFileList({
  files,
  onReorder,
  onRemove,
  disabled,
}: SortableFileListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = files.findIndex((f) => f.id === active.id);
    const newIndex = files.findIndex((f) => f.id === over.id);
    onReorder(arrayMove(files, oldIndex, newIndex));
  }

  if (files.length === 0) return null;

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <div className="px-3 py-1.5 border-b border-border bg-muted/30">
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
          {files.length} file{files.length !== 1 ? 's' : ''}
        </span>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={files.map((f) => f.id)}
          strategy={verticalListSortingStrategy}
        >
          {files.map((item, index) => (
            <SortableItem
              key={item.id}
              item={item}
              index={index}
              onRemove={onRemove}
              disabled={disabled}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}
