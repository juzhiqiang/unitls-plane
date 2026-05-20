var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
let ImageService = class ImageService {
    onModuleInit() {
        sharp.cache(false);
        sharp.concurrency(1);
    }
    async compress(input, opts) {
        let pipeline = sharp(input, { failOn: 'truncated' });
        if (opts.maxWidth || opts.maxHeight) {
            pipeline = pipeline.resize({
                width: opts.maxWidth,
                height: opts.maxHeight,
                fit: 'inside',
                withoutEnlargement: true,
            });
        }
        switch (opts.format ?? 'jpeg') {
            case 'jpeg':
                return pipeline
                    .jpeg({ quality: opts.quality ?? 80, mozjpeg: true })
                    .toBuffer();
            case 'webp':
                return pipeline.webp({ quality: opts.quality ?? 80 }).toBuffer();
            case 'avif':
                return pipeline.avif({ quality: opts.quality ?? 60 }).toBuffer();
            case 'png':
                return pipeline.png({ compressionLevel: 9, palette: true }).toBuffer();
            default:
                throw new Error(`Unsupported format: ${opts.format}`);
        }
    }
    async getMetadata(input) {
        return sharp(input).metadata();
    }
};
ImageService = __decorate([
    Injectable()
], ImageService);
export { ImageService };
//# sourceMappingURL=image.service.js.map