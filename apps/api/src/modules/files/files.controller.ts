import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  Res,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { FilesService } from './files.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { User } from '@utils-plane/db';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
} from '@nestjs/swagger';

interface FileMetadata {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  destination: string;
  filename: string;
  path: string;
  buffer: Buffer;
}

@ApiTags('files')
@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Public()
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 50 * 1024 * 1024 },
    })
  )
  @ApiOperation({ summary: 'Upload a file' })
  @ApiConsumes('multipart/form-data')
  async upload(@UploadedFile() file: FileMetadata, @CurrentUser() user?: User) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    const result = await this.filesService.upload(
      file.buffer,
      {
        filename: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
      },
      user?.id
    );

    return result;
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
  async download(
    @Param('id') id: string,
    @CurrentUser() user?: User,
    @Res() res?: Response,
  ) {
    const file = await this.filesService.getById(id, user?.id);
    const buffer = await this.filesService.download(file.storageKey);

    if (!res) {
      return { url: await this.filesService.getSignedUrl(id, user?.id) };
    }

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', buffer.length.toString());
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(file.filename)}"`,
    );
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.end(buffer);
  }

  @Get()
  @ApiOperation({ summary: 'List files for current user' })
  @ApiBearerAuth()
  async list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('mimeType') mimeType?: string,
    @Query('search') search?: string,
    @CurrentUser() user?: User
  ) {
    if (!user) {
      throw new BadRequestException('User required for listing files');
    }
    return this.filesService.listByUser(user.id, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      mimeType,
      search,
    });
  }

  @Get('trash')
  @ApiOperation({ summary: 'List trashed files for current user' })
  @ApiBearerAuth()
  async listTrash(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @CurrentUser() user?: User
  ) {
    if (!user) {
      throw new BadRequestException('User required for listing trash');
    }
    return this.filesService.listTrashed(user.id, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
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

  @Post('batch-delete')
  @ApiOperation({ summary: 'Batch soft-delete files' })
  @ApiBearerAuth()
  async batchDelete(
    @Body() body: { ids: string[] },
    @CurrentUser() user?: User
  ) {
    if (!user) {
      throw new BadRequestException('User required for batch deletion');
    }
    if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
      throw new BadRequestException('ids array is required');
    }
    await this.filesService.batchSoftDelete(body.ids, user.id);
    return { success: true };
  }
}
