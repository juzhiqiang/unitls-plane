import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { AiTryOnReferencesService } from './services/ai-try-on-references.service';
import {
  AiTryOnReferenceDto,
  ListAiTryOnReferencesQueryDto,
  AI_TRY_ON_REFERENCE_KINDS,
  AI_TRY_ON_REFERENCE_LANGS,
} from './dto/ai-try-on-references.dto';

/**
 * 试衣参考图库检索。
 *
 * 公开只读（@Public）：素材本身经过许可审查，可随页面展示；响应只含
 * 公网可访问的缩略图 URL 与许可信息，绝不泄露 bucket / storage key。
 * 图库原图的服务端解析走 AiTryOnReferencesService.getImageForGeneration，
 * 只存在于任务处理器内部路径，不经过 HTTP。
 */
@ApiTags('tasks')
@Controller('tasks')
export class AiTryOnReferencesController {
  constructor(
    private readonly aiTryOnReferencesService: AiTryOnReferencesService
  ) {}

  @Get('ai-try-on/references')
  @Public()
  @ApiOperation({ summary: 'List AI try-on reference library assets' })
  @ApiQuery({
    name: 'kind',
    required: true,
    enum: AI_TRY_ON_REFERENCE_KINDS,
    description: '素材类别：person 人像 / pose 姿势 / garment 服饰',
  })
  @ApiQuery({
    name: 'lang',
    required: false,
    enum: AI_TRY_ON_REFERENCE_LANGS,
    description: '标题/描述语言，默认 zh',
  })
  @ApiResponse({
    status: 200,
    description:
      'Enabled, license-reviewed reference assets in the requested language',
    type: AiTryOnReferenceDto,
    isArray: true,
  })
  @ApiResponse({ status: 400, description: 'Invalid kind or lang' })
  @ApiResponse({
    status: 304,
    description: 'Catalog unchanged (ETag validation)',
  })
  async listReferences(
    @Query() query: ListAiTryOnReferencesQueryDto,
    @Res({ passthrough: true }) response?: Response
  ) {
    const items = await this.aiTryOnReferencesService.list(
      query.kind,
      query.lang ?? 'zh'
    );
    // Express 根据实际 JSON 生成 ETag，浏览器复用未修改的响应；每次都校验数据库。
    response?.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    return items;
  }
}
