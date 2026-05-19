var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import * as openapi from "@nestjs/swagger";
import { Controller, Get, Post, Delete, Param, Query, Res, UploadedFile, UseInterceptors, BadRequestException, } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FilesService } from './files.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, } from '@nestjs/swagger';
let FilesController = class FilesController {
    filesService;
    constructor(filesService) {
        this.filesService = filesService;
    }
    async upload(file, user) {
        if (!file) {
            throw new BadRequestException('No file provided');
        }
        const result = await this.filesService.upload(file.buffer, {
            filename: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
        }, user?.id);
        return result;
    }
    async getOne(id, user) {
        return this.filesService.getById(id, user?.id);
    }
    async download(id, user, res) {
        const url = await this.filesService.getSignedUrl(id, user?.id);
        if (res) {
            return res.redirect(url);
        }
        return { url };
    }
    async list(page, limit, user) {
        if (!user) {
            throw new BadRequestException('User required for listing files');
        }
        return this.filesService.listByUser(user.id, {
            page: page ? parseInt(page, 10) : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
        });
    }
    async remove(id, user) {
        if (!user) {
            throw new BadRequestException('User required for deleting files');
        }
        await this.filesService.softDelete(id, user.id);
        return { success: true };
    }
};
__decorate([
    Public(),
    Post('upload'),
    UseInterceptors(FileInterceptor('file', {
        limits: { fileSize: 50 * 1024 * 1024 },
    })),
    ApiOperation({ summary: 'Upload a file' }),
    ApiConsumes('multipart/form-data'),
    openapi.ApiResponse({ status: 201 }),
    __param(0, UploadedFile()),
    __param(1, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], FilesController.prototype, "upload", null);
__decorate([
    Get(':id'),
    ApiOperation({ summary: 'Get file by ID' }),
    ApiBearerAuth(),
    openapi.ApiResponse({ status: 200 }),
    __param(0, Param('id')),
    __param(1, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], FilesController.prototype, "getOne", null);
__decorate([
    Public(),
    Get(':id/download'),
    ApiOperation({ summary: 'Download file by ID' }),
    openapi.ApiResponse({ status: 200, type: Object }),
    __param(0, Param('id')),
    __param(1, CurrentUser()),
    __param(2, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], FilesController.prototype, "download", null);
__decorate([
    openapi.ApiQuery({ name: "page", required: false }),
    openapi.ApiQuery({ name: "limit", required: false }),
    Get(),
    ApiOperation({ summary: 'List files for current user' }),
    ApiBearerAuth(),
    openapi.ApiResponse({ status: 200 }),
    __param(0, Query('page')),
    __param(1, Query('limit')),
    __param(2, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Promise)
], FilesController.prototype, "list", null);
__decorate([
    Delete(':id'),
    ApiOperation({ summary: 'Delete file (soft delete)' }),
    ApiBearerAuth(),
    openapi.ApiResponse({ status: 200 }),
    __param(0, Param('id')),
    __param(1, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], FilesController.prototype, "remove", null);
FilesController = __decorate([
    ApiTags('files'),
    Controller('files'),
    __metadata("design:paramtypes", [FilesService])
], FilesController);
export { FilesController };
//# sourceMappingURL=files.controller.js.map