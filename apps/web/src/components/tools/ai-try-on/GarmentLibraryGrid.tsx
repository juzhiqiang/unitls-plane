'use client';

import type {
  AiTryOnReferenceAssetDto,
  AiTryOnReferenceRole,
} from '@/hooks/api/types';
import { ReferenceLibraryGrid } from './ReferenceLibraryGrid';

export interface GarmentLibraryGridProps {
  role?: AiTryOnReferenceRole;
  items: AiTryOnReferenceAssetDto[];
  selectedId: string | null;
  onSelect: (assetId: string | null) => void;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  onFallbackToUpload?: () => void;
  disabled?: boolean;
  optional?: boolean;
}

export function GarmentLibraryGrid({
  role = 'garment',
  ...props
}: GarmentLibraryGridProps) {
  return <ReferenceLibraryGrid role={role} {...props} />;
}
