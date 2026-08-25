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
import { getLimit } from '@utils-plane/utils';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
  ApiQuery,
} from '@nestjs/swagger';
import { normalizeUploadedFilename } from './filename.util';
import {
  buildContentDisposition,
  resolveContentDispositionType,
} from './content-disposition.util';
import { FileIdsDto } from './dto/file-ids.dto';

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
      limits: { fileSize: MAX_UPLOAD_TRANSPORT_SIZE },
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
        filename: normalizeUploadedFilename(file.originalname),
        mimeType: file.mimetype,
        size: file.size,
      },
      user ?? null
    );

    return result;
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
    const buffer = await this.filesService.download(file.storageKey);

    if (!res) {
      return { url: await this.filesService.getSignedUrl(id, user?.id) };
    }

    const dispositionType = resolveContentDispositionType(download);

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', buffer.length.toString());
    res.setHeader(
      'Content-Disposition',
      buildContentDisposition(file.filename, dispositionType)
    );
    res.setHeader('Cache-Control', 'private, max-age=300');
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
