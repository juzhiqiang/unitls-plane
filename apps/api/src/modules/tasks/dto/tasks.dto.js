var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import * as openapi from "@nestjs/swagger";
import { taskStatusEnum } from '@utils-plane/validators';
import { z } from 'zod';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsArray, IsUUID, IsOptional, IsNumber, Min, Max, } from 'class-validator';
export const taskQuerySchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: taskStatusEnum.optional(),
});
export class CreateTaskDto {
    type;
    inputFileIds;
    inputConfig;
    static _OPENAPI_METADATA_FACTORY() {
        return { type: { required: true, type: () => Object } };
    }
}
__decorate([
    ApiProperty({
        enum: ['compress', 'convert', 'pdf_merge', 'pdf_split', 'font_convert'],
    }),
    IsEnum(['compress', 'convert', 'pdf_merge', 'pdf_split', 'font_convert']),
    __metadata("design:type", String)
], CreateTaskDto.prototype, "type", void 0);
__decorate([
    ApiProperty({ type: [String], format: 'uuid' }),
    IsArray(),
    IsUUID('4', { each: true }),
    __metadata("design:type", Array)
], CreateTaskDto.prototype, "inputFileIds", void 0);
__decorate([
    ApiPropertyOptional({ type: Object }),
    IsOptional(),
    __metadata("design:type", Object)
], CreateTaskDto.prototype, "inputConfig", void 0);
export class TaskQueryDto {
    page = 1;
    limit = 20;
    status;
    static _OPENAPI_METADATA_FACTORY() {
        return { page: { required: false, type: () => BigInt, default: 1, minimum: 1 }, limit: { required: false, type: () => BigInt, default: 20, minimum: 1, maximum: 100 }, status: { required: false, type: () => Object } };
    }
}
__decorate([
    ApiPropertyOptional({ default: 1 }),
    IsOptional(),
    IsNumber(),
    Min(1),
    __metadata("design:type", Number)
], TaskQueryDto.prototype, "page", void 0);
__decorate([
    ApiPropertyOptional({ default: 20 }),
    IsOptional(),
    IsNumber(),
    Min(1),
    Max(100),
    __metadata("design:type", Number)
], TaskQueryDto.prototype, "limit", void 0);
__decorate([
    ApiPropertyOptional({
        enum: ['pending', 'processing', 'completed', 'failed'],
    }),
    IsOptional(),
    IsEnum(['pending', 'processing', 'completed', 'failed']),
    __metadata("design:type", String)
], TaskQueryDto.prototype, "status", void 0);
export class TaskResponseDto {
    id;
    userId;
    type;
    status;
    inputFileIds;
    inputConfig;
    outputFileId;
    progress;
    errorCode;
    errorMessage;
    createdAt;
    completedAt;
    static _OPENAPI_METADATA_FACTORY() {
        return { id: { required: true, enum: string }, userId: { required: false, enum: string }, type: { required: true, enum: string }, status: { required: true, enum: string }, outputFileId: { required: false, enum: string }, progress: { required: true, type: () => BigInt }, errorCode: { required: false, enum: string }, errorMessage: { required: false, enum: string } };
    }
}
__decorate([
    ApiProperty({ format: 'uuid' }),
    __metadata("design:type", String)
], TaskResponseDto.prototype, "id", void 0);
__decorate([
    ApiPropertyOptional({ format: 'uuid' }),
    __metadata("design:type", String)
], TaskResponseDto.prototype, "userId", void 0);
__decorate([
    ApiProperty({
        enum: ['compress', 'convert', 'pdf_merge', 'pdf_split', 'font_convert'],
    }),
    __metadata("design:type", String)
], TaskResponseDto.prototype, "type", void 0);
__decorate([
    ApiProperty({ enum: ['pending', 'processing', 'completed', 'failed'] }),
    __metadata("design:type", String)
], TaskResponseDto.prototype, "status", void 0);
__decorate([
    ApiProperty({ type: [String] }),
    __metadata("design:type", Array)
], TaskResponseDto.prototype, "inputFileIds", void 0);
__decorate([
    ApiPropertyOptional({ type: Object }),
    __metadata("design:type", Object)
], TaskResponseDto.prototype, "inputConfig", void 0);
__decorate([
    ApiPropertyOptional({ format: 'uuid' }),
    __metadata("design:type", String)
], TaskResponseDto.prototype, "outputFileId", void 0);
__decorate([
    ApiProperty({ minimum: 0, maximum: 100 }),
    __metadata("design:type", Number)
], TaskResponseDto.prototype, "progress", void 0);
__decorate([
    ApiPropertyOptional(),
    __metadata("design:type", String)
], TaskResponseDto.prototype, "errorCode", void 0);
__decorate([
    ApiPropertyOptional(),
    __metadata("design:type", String)
], TaskResponseDto.prototype, "errorMessage", void 0);
__decorate([
    ApiProperty(),
    __metadata("design:type", Date)
], TaskResponseDto.prototype, "createdAt", void 0);
__decorate([
    ApiPropertyOptional(),
    __metadata("design:type", Date)
], TaskResponseDto.prototype, "completedAt", void 0);
export class TaskStatusDto {
    status;
    progress;
    errorCode;
    errorMessage;
    static _OPENAPI_METADATA_FACTORY() {
        return { status: { required: true, enum: string }, progress: { required: true, type: () => BigInt }, errorCode: { required: false, enum: string }, errorMessage: { required: false, enum: string } };
    }
}
__decorate([
    ApiProperty({ enum: ['pending', 'processing', 'completed', 'failed'] }),
    __metadata("design:type", String)
], TaskStatusDto.prototype, "status", void 0);
__decorate([
    ApiProperty({ minimum: 0, maximum: 100 }),
    __metadata("design:type", Number)
], TaskStatusDto.prototype, "progress", void 0);
__decorate([
    ApiPropertyOptional(),
    __metadata("design:type", String)
], TaskStatusDto.prototype, "errorCode", void 0);
__decorate([
    ApiPropertyOptional(),
    __metadata("design:type", String)
], TaskStatusDto.prototype, "errorMessage", void 0);
//# sourceMappingURL=tasks.dto.js.map