'use client';

import { useEffect, useState } from 'react';
import {
  closestCenter,
  DndContext,
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
import { GripVertical, ImageIcon, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface AnimationFrameFile {
  id: string;
  file: File;
  delayMs: number;
}

export interface AnimationFrameListProps {
  frames: AnimationFrameFile[];
  onReorder: (frames: AnimationFrameFile[]) => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
}

function FrameThumbnail({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  return (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border bg-muted/30">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        <ImageIcon
          className="h-4 w-4 text-muted-foreground"
          strokeWidth={1.5}
        />
      )}
    </div>
  );
}

function SortableFrameItem({
  item,
  index,
  onRemove,
  disabled,
}: {
  item: AnimationFrameFile;
  index: number;
  onRemove: (index: number) => void;
  disabled?: boolean;
}) {
  const tUnits = useTranslations('Common.units');
  const locale = useLocale();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-3 border-b border-border bg-background px-3 py-2 transition-colors last:border-b-0',
        isDragging &&
          'border border-dashed border-accent bg-transparent opacity-40'
      )}
    >
      <button
        type="button"
        className="flex h-8 w-8 shrink-0 cursor-grab items-center justify-center text-muted-foreground transition-colors hover:text-foreground active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-30"
        disabled={disabled}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" strokeWidth={1} />
      </button>

      <FrameThumbnail file={item.file} />

      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-xs text-foreground">
          {item.file.name}
        </p>
        <p className="font-mono text-[10px] tabular-nums text-muted-foreground">
          {formatBytes(item.file.size, tUnits, locale)}
        </p>
      </div>

      <div className="flex w-16 shrink-0 flex-col items-end gap-0.5 font-mono tabular-nums">
        <span className="text-[10px] text-muted-foreground">
          {String(index + 1).padStart(2, '0')}
        </span>
        <span className="text-[10px] text-foreground">{item.delayMs} ms</span>
      </div>

      <button
        type="button"
        onClick={() => onRemove(index)}
        disabled={disabled}
        aria-label={`Remove ${item.file.name}`}
        className="flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-destructive disabled:opacity-30"
      >
        <X className="h-3.5 w-3.5" strokeWidth={1.5} />
      </button>
    </div>
  );
}

export function AnimationFrameList({
  frames,
  onReorder,
  onRemove,
  disabled,
}: AnimationFrameListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = frames.findIndex(frame => frame.id === active.id);
    const newIndex = frames.findIndex(frame => frame.id === over.id);
    onReorder(arrayMove(frames, oldIndex, newIndex));
  }

  if (frames.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="border-b border-border bg-muted/30 px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {frames.length} frame{frames.length === 1 ? '' : 's'}
        </span>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={frames.map(frame => frame.id)}
          strategy={verticalListSortingStrategy}
        >
          {frames.map((item, index) => (
            <SortableFrameItem
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
