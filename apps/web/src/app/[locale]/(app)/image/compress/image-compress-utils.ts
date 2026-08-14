import { getLimit } from '@utils-plane/utils';
import type { FileItem } from '@/components/tools/file-list';
import {
  getEntitlementUserFromSession,
  type EntitlementSession,
} from '@/lib/entitlement-session';

export function getImageCompressionIndices(
  items: readonly FileItem[]
): number[] {
  return items.map((_, index) => index);
}

export function getImageCompressionMaxFileSize(
  session: EntitlementSession
): number {
  return getLimit(getEntitlementUserFromSession(session), 'upload.maxFileSize');
}
