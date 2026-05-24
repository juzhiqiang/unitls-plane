import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { FontService } from './services/font.service';
import { FilesService } from '../files/files.service';

@ApiTags('fonts')
@Controller('fonts')
export class FontsController {
  constructor(
    private readonly fontService: FontService,
    private readonly filesService: FilesService,
  ) {}

  @Get(':fileId/info')
  @Public()
  @ApiOperation({ summary: 'Get font file metadata' })
  @ApiResponse({ status: 200, description: 'Font info' })
  @ApiResponse({ status: 400, description: 'Invalid font file' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async getFontInfo(@Param('fileId') fileId: string) {
    const file = await this.filesService.getById(fileId);
    const buffer = await this.filesService.download(file.storageKey);
    return this.fontService.getFontInfo(buffer);
  }
}
