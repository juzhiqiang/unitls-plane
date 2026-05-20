import { OnModuleInit } from '@nestjs/common';
import sharp from 'sharp';
export interface CompressOptions {
    format?: 'jpeg' | 'webp' | 'avif' | 'png';
    quality?: number;
    maxWidth?: number;
    maxHeight?: number;
}
export declare class ImageService implements OnModuleInit {
    onModuleInit(): void;
    compress(input: Buffer, opts: CompressOptions): Promise<Buffer>;
    getMetadata(input: Buffer): Promise<sharp.Metadata>;
}
//# sourceMappingURL=image.service.d.ts.map