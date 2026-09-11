import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  Res,
  Req,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { FilesService } from './files.service';
import { ErrorCodes } from '../../common/errors/error-codes';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { User } from '@utils-plane/db';
import { getLimit } from '@utils-plane/utils';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { normalizeUploadedFilename } from './filename.util';
import {
  canThumbnailFile,
  THUMBNAIL_CONTENT_TYPE,
  THUMBNAIL_MAX_EDGE,
} from './thumbnail.util';
import {
  buildContentDisposition,
  resolveContentDispositionType,
} from './content-disposition.util';
import { FileIdsDto } from './dto/file-ids.dto';
import { UploadBudgetInterceptor } from './upload-budget.interceptor';
import {
  createUploadTempStorage,
  removeUploadTempFile,
  resolveUploadMaxFileSize,
} from './upload-temp-file';
import { parseIncludeTotal } from '../../common/database/list-pagination';

const MAX_UPLOAD_TRANSPORT_SIZE = getLimit(
  { userId: 'transport-cap', plan: 'private' },
  'upload.maxFileSize'
);

interface FileMetadata {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  destination: string;
  filename: string;
  path: string;
  buffer?: Buffer;
}

@ApiTags('files')
@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Public()
  @Post('upload')
  @UseInterceptors(
    UploadBudgetInterceptor,
    FileInterceptor('file', {
      storage: createUploadTempStorage(resolveUploadMaxFileSize),
      limits: {
        fileSize: MAX_UPLOAD_TRANSPORT_SIZE,
        files: 1,
        fields: 10,
        fieldSize: 64 * 1024,
      },
    })
  )
  @ApiOperation({ summary: 'Upload a file' })
  @ApiConsumes('multipart/form-data')
  async upload(
    @UploadedFile() file: FileMetadata,
    @CurrentUser() user?: User,
    @Req() request?: Request
  ) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    const abortController = new globalThis.AbortController();
    const onAborted = () => abortController.abort();
    const onRequestError = () => abortController.abort();
    const onRequestClosed = () => {
      if (!request?.readableEnded) abortController.abort();
    };
    request?.once('aborted', onAborted);
    request?.once('error', onRequestError);
    request?.once('close', onRequestClosed);
    if (request?.destroyed && !request.readableEnded) abortController.abort();

    try {
      return await this.filesService.upload(
        { path: file.path, size: file.size },
        {
          filename: normalizeUploadedFilename(file.originalname),
          mimeType: file.mimetype,
          size: file.size,
        },
        user ?? null,
        request ? abortController.signal : undefined
      );
    } finally {
      request?.off('aborted', onAborted);
      request?.off('error', onRequestError);
      request?.off('close', onRequestClosed);
      try {
        await removeUploadTempFile(file.path);
      } catch {
        // Do not replace the upload error with a best-effort cleanup error.
      }
    }
  }

  @Get('trash')
  @ApiOperation({ summary: 'List trashed files for current user' })
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'object', additionalProperties: true },
        },
        total: { type: 'number', nullable: true },
        nextCursor: { type: 'string', nullable: true },
      },
      required: ['files', 'total', 'nextCursor'],
    },
  })
  @ApiBearerAuth()
  @ApiQuery({
    name: 'includeTotal',
    required: false,
    type: Boolean,
    description: 'Cursor 模式是否返回 total；旧分页默认 true',
  })
  async listTrash(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @CurrentUser() user?: User,
    @Query('cursor') cursor?: string,
    @Query('includeTotal') includeTotal?: string
  ) {
    if (!user) {
      throw new BadRequestException('User required for listing trash');
    }
    return this.filesService.listTrashed(user.id, {
      page: page !== undefined ? Number(page) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
      cursor,
      includeTotal: parseIncludeTotal(includeTotal),
    });
  }

  @Delete('trash/empty')
  @ApiOperation({ summary: 'Empty trash for current user' })
  @ApiBearerAuth()
  async emptyTrash(@CurrentUser() user?: User) {
    if (!user) {
      throw new BadRequestException('User required for emptying trash');
    }
    await this.filesService.emptyTrash(user.id);
    return { success: true };
  }

  @Post('batch-delete')
  @ApiOperation({ summary: 'Batch soft-delete files' })
  @ApiBearerAuth()
  async batchDelete(@Body() body: FileIdsDto, @CurrentUser() user?: User) {
    if (!user) {
      throw new BadRequestException('User required for batch deletion');
    }
    await this.filesService.batchSoftDelete(body.ids, user.id);
    return { success: true };
  }

  @Post('batch-restore')
  @ApiOperation({ summary: 'Batch restore soft-deleted files' })
  @ApiBearerAuth()
  async batchRestore(@Body() body: FileIdsDto, @CurrentUser() user?: User) {
    if (!user) {
      throw new BadRequestException('User required for batch restore');
    }
    await this.filesService.batchRestore(body.ids, user.id);
    return { success: true };
  }

  @Post('batch-permanent-delete')
  @ApiOperation({ summary: 'Batch permanently delete files from trash' })
  @ApiBearerAuth()
  async batchPermanentDelete(
    @Body() body: FileIdsDto,
    @CurrentUser() user?: User
  ) {
    if (!user) {
      throw new BadRequestException('User required for permanent deletion');
    }
    await this.filesService.batchPermanentDelete(body.ids, user.id);
    return { success: true };
  }

  @Get()
  @ApiOperation({ summary: 'List files for current user' })
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'object', additionalProperties: true },
        },
        total: { type: 'number', nullable: true },
        nextCursor: { type: 'string', nullable: true },
      },
      required: ['files', 'total', 'nextCursor'],
    },
  })
  @ApiBearerAuth()
  @ApiQuery({
    name: 'includeTotal',
    required: false,
    type: Boolean,
    description: 'Cursor 模式是否返回 total；旧分页默认 true',
  })
  async list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('mimeType') mimeType?: string,
    @Query('search') search?: string,
    @CurrentUser() user?: User,
    @Query('cursor') cursor?: string,
    @Query('includeTotal') includeTotal?: string
  ) {
    if (!user) {
      throw new BadRequestException('User required for listing files');
    }
    return this.filesService.listByUser(user.id, {
      page: page !== undefined ? Number(page) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
      cursor,
      mimeType,
      search,
      includeTotal: parseIncludeTotal(includeTotal),
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get file by ID' })
  @ApiBearerAuth()
  async getOne(@Param('id') id: string, @CurrentUser() user?: User) {
    return this.filesService.getById(id, user?.id);
  }

  @Public()
  @Get(':id/download')
  @ApiOperation({ summary: 'Download file by ID' })
  @ApiQuery({
    name: 'download',
    required: false,
    description:
      'Set to 1/true to force an attachment download instead of inline preview',
  })
  async download(
    @Param('id') id: string,
    @Query('download') download?: string,
    @CurrentUser() user?: User,
    @Res() res?: Response
  ) {
    const file = await this.filesService.getById(id, user?.id);

    if (!res) {
      return { url: await this.filesService.getSignedUrl(id, user?.id) };
    }

    if (res.destroyed) return;
    const abort = new globalThis.AbortController();
    const onClose = () => abort.abort();
    res.once('close', onClose);
    let source: Readable | undefined;
    try {
      source = await this.filesService.downloadStream(
        file.storageKey,
        abort.signal
      );
      if (res.destroyed || abort.signal.aborted) {
        source.destroy();
        return;
      }
      res.setHeader('Content-Type', file.mimeType);
      res.setHeader('Content-Length', String(file.originalSize));
      res.setHeader(
        'Content-Disposition',
        buildContentDisposition(
          file.filename,
          resolveContentDispositionType(download)
        )
      );
      res.setHeader('Cache-Control', 'private, max-age=300');
      await pipeline(source, res);
    } finally {
      source?.destroy();
      res.off('close', onClose);
    }
  }

  /**
   * 列表缩略图。访问控制与 download 完全一致(都走 getById),不新增暴露面;
   * 只是把原图缩到 320px WebP,网格不必再为一张 3 MB 的生图退化成类型图标。
   */
  @Public()
  @Get(':id/thumbnail')
  @ApiOperation({ summary: 'Get a downscaled thumbnail for an image file' })
  async thumbnail(
    @Param('id') id: string,
    @CurrentUser() user?: User,
    @Res() res?: Response
  ) {
    const file = await this.filesService.getById(id, user?.id);

    if (!canThumbnailFile(file)) {
      throw new BadRequestException({
        code: ErrorCodes.INVALID_FILE_TYPE,
        message: 'Thumbnails are only available for images',
      });
    }

    const buffer = await this.filesService.thumbnail(file.storageKey);

    if (!res) {
      return buffer;
    }

    res.setHeader('Content-Type', THUMBNAIL_CONTENT_TYPE);
    res.setHeader('Content-Length', buffer.length.toString());
    // 文件内容不可变,缩略图只随 id 变化:直接让浏览器长时间复用,列表滚动不再重复请求。
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('ETag', `"thumb-${file.id}-${THUMBNAIL_MAX_EDGE}"`);
    return res.end(buffer);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete file (soft delete)' })
  @ApiBearerAuth()
  async remove(@Param('id') id: string, @CurrentUser() user?: User) {
    if (!user) {
      throw new BadRequestException('User required for deleting files');
    }
    await this.filesService.softDelete(id, user.id);
    return { success: true };
  }

  @Post(':id/restore')
  @ApiOperation({ summary: 'Restore a soft-deleted file' })
  @ApiBearerAuth()
  async restore(@Param('id') id: string, @CurrentUser() user?: User) {
    if (!user) {
      throw new BadRequestException('User required for restoring files');
    }
    await this.filesService.restore(id, user.id);
    return { success: true };
  }

  @Delete(':id/permanent')
  @ApiOperation({ summary: 'Permanently delete a file' })
  @ApiBearerAuth()
  async permanentRemove(@Param('id') id: string, @CurrentUser() user?: User) {
    if (!user) {
      throw new BadRequestException('User required for permanent deletion');
    }
    await this.filesService.permanentDelete(id, user.id);
    return { success: true };
  }
}
