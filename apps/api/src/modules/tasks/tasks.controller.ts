import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
  UnauthorizedException,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { TasksService } from './tasks.service';
import { ImageGenerationService } from './services/image-generation.service';
import { ImageGeneratePresetsService } from './services/image-generate-presets.service';
import {
  CreateTaskDto,
  TaskQueryDto,
  TaskResponseDto,
  TaskStatusDto,
  ImageGenerateQuotaDto,
  ImageGenerateProviderDto,
  ImageGeneratePresetDto,
  ImageGenerateSessionDto,
  ImageGenerateSessionTasksDto,
} from './dto/tasks.dto';
import { Public } from '../../common/decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { User } from '@utils-plane/db';
import type { Request } from 'express';

interface AuthenticatedRequest extends Request {
  user?: User;
}

@ApiTags('tasks')
@Controller('tasks')
export class TasksController {
  constructor(
    private readonly tasksService: TasksService,
    private readonly imageGenerationService: ImageGenerationService,
    private readonly imageGeneratePresetsService: ImageGeneratePresetsService
  ) {}

  @Post()
  @Public()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new task' })
  @ApiResponse({
    status: 201,
    description: 'Task created',
    type: TaskResponseDto,
  })
  async create(@Body() dto: CreateTaskDto, @Req() req: AuthenticatedRequest) {
    const user = req.user;
    return this.tasksService.create(
      {
        type: dto.type,
        inputFileIds: dto.inputFileIds,
        inputConfig: dto.inputConfig ?? {},
      },
      user ?? null
    );
  }

  /**
   * 可用生图来源列表。
   *
   * 只下发 id / label / capabilities;baseUrl 与 apiKey 属于服务端配置,绝不出网。
   * 与额度接口一致要求登录:生图本身就必须登录,匿名拿这个列表没有用途。
   */
  @Get('image-generate/providers')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List the configured image generation providers' })
  @ApiResponse({
    status: 200,
    description: 'Configured image generation providers',
    type: ImageGenerateProviderDto,
    isArray: true,
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async listImageGenerateProviders(@CurrentUser() currentUser?: User) {
    if (!currentUser) throw new UnauthorizedException();
    return this.imageGenerationService.listProviders();
  }

  @Get('image-generate/quota')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the daily image generation quota snapshot' })
  @ApiResponse({
    status: 200,
    description: 'Today image generation quota',
    type: ImageGenerateQuotaDto,
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async getImageGenerateQuota(@CurrentUser() currentUser?: User) {
    if (!currentUser) throw new UnauthorizedException();
    return this.tasksService.getImageGenerateQuota(currentUser);
  }

  /**
   * AI 生图提示词模板列表。
   *
   * 必须声明在 `@Get(':id')` 之前,否则 `:id` 会吞掉 `image-generate` 字面段。
   *
   * 设为 @Public():模板内容只是展示用提示词 + 示例图对象 key,不含任何用户数据或服务端凭据;
   * 弹窗本身在需登录的生图页内,端点公开可省去前端 session 门控。
   *
   * lang 决定取双语言列的哪一侧,返回单语言扁平对象,前端零字段切换。
   */
  @Get('image-generate/presets')
  @Public()
  @ApiOperation({ summary: 'List AI image generation prompt presets' })
  @ApiResponse({
    status: 200,
    description: 'Enabled prompt presets in the requested language',
    type: ImageGeneratePresetDto,
    isArray: true,
  })
  async listImageGeneratePresets(@Query('lang') lang?: string) {
    return this.imageGeneratePresetsService.list(lang === 'en' ? 'en' : 'zh');
  }

  /**
   * 生图会话列表(对话式布局左侧栏)。
   *
   * 同 providers/quota 一样要求登录:生图任务本身必须登录,会话由任务派生。
   * 必须声明在 `@Get(':id')` 之前。
   */
  @Get('image-generate/sessions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List AI image generation sessions' })
  @ApiResponse({
    status: 200,
    description: 'Sessions derived from image generate tasks, newest first',
    type: ImageGenerateSessionDto,
    isArray: true,
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async listImageGenerateSessions(@CurrentUser() currentUser?: User) {
    if (!currentUser) throw new UnauthorizedException();
    return this.tasksService.listImageGenerateSessions(currentUser.id);
  }

  /** 单个会话的任务列表(消息流数据源)。sessionId 非法 uuid 直接 400。 */
  @Get('image-generate/sessions/:sessionId/tasks')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List the tasks of one image generation session' })
  @ApiResponse({
    status: 200,
    description: 'Session tasks ordered by creation time ascending',
    type: ImageGenerateSessionTasksDto,
  })
  @ApiResponse({ status: 400, description: 'sessionId is not a valid UUID' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async listImageGenerateSessionTasks(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() currentUser?: User
  ) {
    if (!currentUser) throw new UnauthorizedException();
    return this.tasksService.listImageGenerateSessionTasks(
      currentUser.id,
      sessionId
    );
  }

  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get task by ID' })
  @ApiResponse({
    status: 200,
    description: 'Task details',
    type: TaskResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Task not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async getOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const userId = req.user?.id;
    return this.tasksService.getById(id, userId);
  }

  @Get(':id/status')
  @Public()
  @SkipThrottle()
  @ApiOperation({ summary: 'Get task status (lightweight)' })
  @ApiResponse({ status: 200, description: 'Task status', type: TaskStatusDto })
  async getStatus(@Param('id') id: string) {
    const task = await this.tasksService.getById(id);
    return {
      status: task.status,
      progress: task.progress,
      outputFileId: task.outputFileId,
      errorCode: task.errorCode,
      errorMessage: task.errorMessage,
    };
  }

  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List user tasks' })
  @ApiResponse({ status: 200, description: 'Task list' })
  async list(@Query() query: TaskQueryDto, @Req() req: AuthenticatedRequest) {
    const userId = req.user?.id;
    if (!userId) {
      return { tasks: [], total: 0 };
    }
    return this.tasksService.listByUser(userId, {
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      status: query.status,
      type: query.type,
    });
  }

  @Post(':id/retry')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Retry a failed task' })
  @ApiResponse({
    status: 201,
    description: 'New task created',
    type: TaskResponseDto,
  })
  async retry(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const user = req.user;
    const original = await this.tasksService.getById(id, user?.id);
    return this.tasksService.create(
      {
        type: original.type,
        inputFileIds: original.inputFileIds as string[],
        inputConfig: (original.inputConfig as Record<string, unknown>) ?? {},
      },
      user ?? null
    );
  }
}
