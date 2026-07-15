import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const SKIP_SESSION_KEY = 'skipSession';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
export const SkipSession = () => SetMetadata(SKIP_SESSION_KEY, true);
