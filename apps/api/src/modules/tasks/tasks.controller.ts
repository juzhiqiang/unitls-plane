import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
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
} from './dto/tasks.dto';
import { Public } from '../../common/decorators';
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
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new task' })
  @ApiResponse({
    status: 201,
    description: 'Task created',
    type: TaskResponseDto,
  })
  async create(@Body() dto: CreateTaskDto, @Req() req: AuthenticatedRequest) {
    const userId = req.user?.id;
    return this.tasksService.create(
      {
        type: dto.type,
        inputFileIds: dto.inputFileIds,
        inputConfig: dto.inputConfig ?? {},
      },
      userId
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
    });
  }
}
