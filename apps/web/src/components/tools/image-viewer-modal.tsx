'use client';

import { useState } from 'react';
import { X, ZoomIn, ZoomOut, Download } from 'lucide-react';

interface ImageViewerModalProps {
  src: string;
  alt: string;
  isOpen: boolean;
  onClose: () => void;
}

export function ImageViewerModal({
  src,
  alt,
  isOpen,
  onClose,
}: ImageViewerModalProps) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  if (!isOpen) return null;

  const handleZoomIn = () => setScale(prev => Math.min(prev + 0.25, 3));
  const handleZoomOut = () => setScale(prev => Math.max(prev - 0.25, 1));
  const handleReset = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale === 1) return; // 不放大时不能拖动
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = src;
    a.download = alt || 'image';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm"
      onClick={onClose}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* 工具栏 */}
      <div className="absolute top-4 left-4 right-4 flex items-center justify-between z-50">
        <div className="text-white text-sm font-mono">
          {Math.round(scale * 100)}%
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleZoomOut}
            disabled={scale <= 1}
            className="p-2 rounded-md bg-white/10 hover:bg-white/20 text-white disabled:opacity-50 transition-colors"
            title="缩小"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            onClick={handleReset}
            className="p-2 rounded-md bg-white/10 hover:bg-white/20 text-white transition-colors"
            title="重置"
          >
            <span className="text-xs font-mono">1:1</span>
          </button>
          <button
            onClick={handleZoomIn}
            disabled={scale >= 3}
            className="p-2 rounded-md bg-white/10 hover:bg-white/20 text-white disabled:opacity-50 transition-colors"
            title="放大"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            onClick={handleDownload}
            className="p-2 rounded-md bg-white/10 hover:bg-white/20 text-white transition-colors"
            title="下载"
          >
            <Download className="h-4 w-4" />
          </button>
          <button
            onClick={onClose}
            className="p-2 rounded-md bg-white/10 hover:bg-white/20 text-white transition-colors"
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 图片容器 */}
      <div
        className="absolute inset-0 flex items-center justify-center overflow-hidden cursor-move"
        onClick={e => e.stopPropagation()}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          onMouseDown={handleMouseDown}
          style={{
            transform: \	ranslate(\px, \px) scale(\)\,
            transformOrigin: 'center',
            cursor: isDragging ? 'grabbing' : scale > 1 ? 'grab' : 'move',
            maxHeight: '90vh',
            maxWidth: '90vw',
            userSelect: 'none',
            transition: isDragging ? 'none' : 'transform 0.1s ease-out',
          }}
        />
      </div>

      {/* 提示文本 */}
      <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 text-white/60 text-xs font-mono text-center">
        {scale > 1 ? '鼠标拖动移动图片' : '滚动放大或使用按钮'}
      </div>
    </div>
  );
}
