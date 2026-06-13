'use client';

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import {
  useFiles,
  useDeleteFile,
  useBatchDeleteFiles,
  useUploadFile,
  type FileQuery,
  type FileRecord,
} from '@/hooks/api/use-files';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { authClient } from '@/lib/auth-client';
import {
  Search,
  Grid3X3,
  List,
  Trash2,
  Download,
  X,
} from 'lucide-react';
import { Link } from '@/i18n/navigation';

type ViewMode = 'grid' | 'list';
type TypeFilter = 'all' | 'image' | 'pdf' | 'font';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getMimePrefix(filter: TypeFilter): string | undefined {
  switch (filter) {
    case 'image':
      return 'image/';
    case 'pdf':
      return 'application/pdf';
    case 'font':
      return 'font/';
    default:
      return undefined;
  }
}

export default function FilesPage() {
  const t = useTranslations('FilesTool');
  const router = useRouter();
  const { data: session } = authClient.useSession();

  const [view, setView] = useState<ViewMode>('grid');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const query: FileQuery = {
    page,
    limit: 12,
    mimeType: getMimePrefix(typeFilter),
    search: search || undefined,
  };

  const { data, isLoading } = useFiles(query);
  const deleteFile = useDeleteFile();
  const batchDelete = useBatchDeleteFiles();
  const uploadFile = useUploadFile();

  const files = data?.files ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 12);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === files.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(files.map((f) => f.id)));
    }
  };

  const handleBatchDelete = async () => {
    if (selected.size === 0) return;
    await batchDelete.mutateAsync(Array.from(selected));
    setSelected(new Set());
  };

  const handleDownload = (file: FileRecord) => {
    const url = `${process.env.NEXT_PUBLIC_API_URL}/files/${file.id}/download`;
    const a = document.createElement('a');
    a.href = url;
    a.download = file.filename;
    a.click();
  };

  const handleDrop = useCallback(
    async (droppedFiles: File[]) => {
      for (const file of droppedFiles) {
        await uploadFile.mutateAsync(file);
      }
    },
    [uploadFile],
  );

  const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
    { value: 'all', label: t('allTypes') },
    { value: 'image', label: t('images') },
    { value: 'pdf', label: t('pdfs') },
    { value: 'font', label: t('fonts') },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg font-medium">{t('title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t('description')}
          </p>
        </div>
        <Link
          href="/files/trash"
          className="inline-flex items-center gap-2 px-3 h-8 text-xs font-mono text-muted-foreground border border-border rounded-md hover:text-foreground hover:border-foreground/20 transition-colors self-start sm:self-auto"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
          {t('trash')}
        </Link>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-[320px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={t('search')}
            className="w-full h-8 pl-9 pr-3 text-sm bg-transparent border border-border rounded-md focus:outline-none focus:border-accent transition-colors placeholder:text-muted-foreground"
          />
        </div>

        {/* Type filter */}
        <div className="flex border border-border rounded-md overflow-hidden">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => {
                setTypeFilter(f.value);
                setPage(1);
              }}
              className={`px-3 h-8 text-[11px] font-mono uppercase tracking-wider transition-colors relative ${
                typeFilter === f.value
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {f.label}
              {typeFilter === f.value && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent" />
              )}
            </button>
          ))}
        </div>

        {/* View toggle */}
        <div className="flex border border-border rounded-md overflow-hidden ml-auto">
          <button
            type="button"
            onClick={() => setView('grid')}
            aria-label={t('gridView')}
            className={`px-2.5 h-8 transition-colors relative ${
              view === 'grid' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Grid3X3 className="h-3.5 w-3.5" strokeWidth={1.5} />
            {view === 'grid' && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setView('list')}
            aria-label={t('listView')}
            className={`px-2.5 h-8 transition-colors relative ${
              view === 'list' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <List className="h-3.5 w-3.5" strokeWidth={1.5} />
            {view === 'list' && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent" />
            )}
          </button>
        </div>
      </div>

      {/* Batch actions */}
      <div
        role="toolbar"
        aria-label={t('actions')}
        aria-hidden={selected.size === 0}
        className={`flex min-h-11 items-center gap-3 py-2 transition-opacity ${
          selected.size === 0 ? 'pointer-events-none opacity-0' : 'opacity-100'
        }`}
      >
        {selected.size > 0 && (
          <>
            <span className="text-xs font-mono text-muted-foreground">
              {t('selected', { count: selected.size })}
            </span>
            <button
              type="button"
              onClick={handleBatchDelete}
              disabled={batchDelete.isPending}
              className="inline-flex items-center gap-1.5 px-3 h-7 text-xs font-mono text-destructive border border-destructive/30 rounded-md hover:bg-destructive/10 transition-colors disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" strokeWidth={1.5} />
              {t('batchDelete')}
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              aria-label={t('clearSelection')}
              className="p-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          </>
        )}
      </div>

      {/* Drop zone for upload */}
      {files.length === 0 && !isLoading && !search && typeFilter === 'all' && (
        <FileDropzone
          accept={{
            'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.gif'],
            'application/pdf': ['.pdf'],
            'font/ttf': ['.ttf'],
            'font/otf': ['.otf'],
            'font/woff': ['.woff'],
            'font/woff2': ['.woff2'],
          }}
          maxSize={50 * 1024 * 1024}
          multiple
          onDrop={handleDrop}
          hint={t('dropToUpload')}
        />
      )}

      {/* Empty state */}
      {files.length === 0 && !isLoading && (search || typeFilter !== 'all') && (
        <p className="text-sm text-muted-foreground py-12 text-center">
          {t('empty')}
        </p>
      )}

      {/* Grid view */}
      {view === 'grid' && files.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {files.map((file) => (
            <div
              key={file.id}
              className={`border rounded-md p-4 space-y-2 transition-colors cursor-pointer ${
                selected.has(file.id)
                  ? 'border-accent/60 bg-accent/5'
                  : 'border-border hover:border-foreground/20'
              }`}
              onClick={() => toggleSelect(file.id)}
            >
              <div className="flex items-start justify-between">
                <input
                  type="checkbox"
                  checked={selected.has(file.id)}
                  onChange={() => toggleSelect(file.id)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={t('selectFile', { filename: file.filename })}
                  className="h-3.5 w-3.5 rounded-none border border-border bg-transparent checked:bg-accent checked:border-accent mt-0.5"
                />
                <div className="flex gap-1">
                  <button
                    type="button"
                    aria-label={t('downloadFile', { filename: file.filename })}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDownload(file);
                    }}
                    className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                  <button
                    type="button"
                    aria-label={t('deleteFile', { filename: file.filename })}
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteFile.mutate(file.id);
                    }}
                    className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                </div>
              </div>
              <p className="text-sm truncate" title={file.filename}>
                {file.filename}
              </p>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                  {file.mimeType.split('/')[1]}
                </span>
                <span className="text-[10px] font-mono text-muted-foreground">
                  {formatFileSize(file.originalSize)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* List view */}
      {view === 'list' && files.length > 0 && (
        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <div className="min-w-[640px] sm:min-w-0">
            {/* Table header */}
            <div className="grid grid-cols-[24px_1fr_100px_100px_100px_80px] gap-3 px-3 py-2 border-b border-border">
              <input
                type="checkbox"
                checked={selected.size === files.length && files.length > 0}
                onChange={selectAll}
                aria-label={t('selectAll')}
                className="h-3.5 w-3.5 rounded-none border border-border bg-transparent checked:bg-accent checked:border-accent mt-0.5"
              />
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                {t('filename')}
              </span>
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                {t('type')}
              </span>
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                {t('size')}
              </span>
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                {t('uploaded')}
              </span>
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider text-right">
                {t('actions')}
              </span>
            </div>
            {/* Table rows */}
            {files.map((file) => (
              <div
                key={file.id}
                className={`grid grid-cols-[24px_1fr_100px_100px_100px_80px] gap-3 px-3 py-3 border-b border-border transition-colors ${
                  selected.has(file.id) ? 'bg-accent/5' : 'hover:bg-muted/40'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(file.id)}
                  onChange={() => toggleSelect(file.id)}
                  aria-label={t('selectFile', { filename: file.filename })}
                  className="h-3.5 w-3.5 rounded-none border border-border bg-transparent checked:bg-accent checked:border-accent mt-0.5"
                />
                <span className="text-sm truncate" title={file.filename}>
                  {file.filename}
                </span>
                <span className="text-[11px] font-mono text-muted-foreground uppercase">
                  {file.mimeType.split('/')[1]}
                </span>
                <span className="text-[11px] font-mono text-muted-foreground">
                  {formatFileSize(file.originalSize)}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {formatDate(file.createdAt)}
                </span>
                <div className="flex justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => handleDownload(file)}
                    aria-label={t('downloadFile', { filename: file.filename })}
                    className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteFile.mutate(file.id)}
                    aria-label={t('deleteFile', { filename: file.filename })}
                    className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPage(p)}
              className={`h-7 w-7 text-xs font-mono rounded-md transition-colors ${
                p === page
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground border border-border'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
