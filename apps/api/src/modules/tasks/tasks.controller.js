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
import { Controller, Post, Get, Param, Body, Query, Req, } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, } from '@nestjs/swagger';
import { TasksService } from './tasks.service';
import { CreateTaskDto, TaskQueryDto, TaskResponseDto, TaskStatusDto, } from './dto/tasks.dto';
let TasksController = class TasksController {
    tasksService;
    constructor(tasksService) {
        this.tasksService = tasksService;
    }
    async create(dto, req) {
        const userId = req.user?.id;
        return this.tasksService.create({
            type: dto.type,
            inputFileIds: dto.inputFileIds,
            inputConfig: dto.inputConfig ?? {},
        }, userId);
    }
    async getOne(id, req) {
        const userId = req.user?.id;
        return this.tasksService.getById(id, userId);
    }
    async getStatus(id) {
        const task = await this.tasksService.getById(id);
        return {
            status: task.status,
            progress: task.progress,
            errorCode: task.errorCode,
            errorMessage: task.errorMessage,
        };
    }
    async list(query, req) {
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
};
__decorate([
    Post(),
    ApiBearerAuth(),
    ApiOperation({ summary: 'Create a new task' }),
    ApiResponse({
        status: 201,
        description: 'Task created',
        type: TaskResponseDto,
    }),
    __param(0, Body()),
    __param(1, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [CreateTaskDto, Object]),
    __metadata("design:returntype", Promise)
], TasksController.prototype, "create", null);
__decorate([
    Get(':id'),
    ApiBearerAuth(),
    ApiOperation({ summary: 'Get task by ID' }),
    ApiResponse({
        status: 200,
        description: 'Task details',
        type: TaskResponseDto,
    }),
    ApiResponse({ status: 404, description: 'Task not found' }),
    ApiResponse({ status: 403, description: 'Access denied' }),
    __param(0, Param('id')),
    __param(1, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], TasksController.prototype, "getOne", null);
__decorate([
    Get(':id/status'),
    ApiBearerAuth(),
    ApiOperation({ summary: 'Get task status (lightweight)' }),
    ApiResponse({ status: 200, description: 'Task status', type: TaskStatusDto }),
    __param(0, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], TasksController.prototype, "getStatus", null);
__decorate([
    Get(),
    ApiBearerAuth(),
    ApiOperation({ summary: 'List user tasks' }),
    ApiResponse({ status: 200, description: 'Task list' }),
    __param(0, Query()),
    __param(1, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [TaskQueryDto, Object]),
    __metadata("design:returntype", Promise)
], TasksController.prototype, "list", null);
TasksController = __decorate([
    ApiTags('tasks'),
    Controller('tasks'),
    __metadata("design:paramtypes", [TasksService])
], TasksController);
export { TasksController };
//# sourceMappingURL=tasks.controller.js.map