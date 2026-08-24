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
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { TasksService } from './tasks.service';
import {
  CreateTaskDto,
  TaskQueryDto,
  TaskResponseDto,
  TaskStatusDto,
  ImageGenerateQuotaDto,
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
  constructor(private readonly tasksService: TasksService) {}

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
