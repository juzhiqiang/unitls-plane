# 08 - Tasks Module (任务 CRUD)

> 依赖：01-nestjs-init、Phase 1 / 03-db
> 预估：2.5h
> 可并行：与 02/03/04/05/06 同时执行

## 目标

实现任务创建、查询、状态轮询接口（不含具体处理逻辑，那部分在 Phase 4+ 实现）。

## 步骤

### 8.1 创建 TasksModule

`apps/api/src/modules/tasks/tasks.module.ts`:
```typescript
@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'image-queue' },
      { name: 'pdf-queue' },
      { name: 'font-queue' },
    ),
  ],
  controllers: [TasksController],
  providers: [
    TasksService,
    ImageProcessor,
    PdfProcessor,
    FontProcessor,
  ],
})
export class TasksModule {}
```

### 8.2 实现 TasksService

`apps/api/src/modules/tasks/tasks.service.ts`:
```typescript
@Injectable()
export class TasksService {
  constructor(
    @InjectQueue('image-queue') private imageQueue: Queue,
    @InjectQueue('pdf-queue') private pdfQueue: Queue,
    @InjectQueue('font-queue') private fontQueue: Queue,
  ) {}

  async create(input: CreateTaskInput, userId?: string): Promise<Task> {
    // 1. 创建 DB 任务记录 (status: pending)
    const task = await db.insert(tasks).values({...}).returning();

    // 2. 根据 type 派发到对应队列
    const queue = this.getQueue(input.type);
    await queue.add(input.type, { taskId: task.id }, {
      jobId: task.id,
    });

    return task;
  }

  async getById(id: string, userId?: string): Promise<Task> { ... }
  async listByUser(userId: string, query: TaskQuery): Promise<Task[]> { ... }
  async updateProgress(id: string, progress: number): Promise<void> { ... }
  async markCompleted(id: string, outputFileId: string): Promise<void> { ... }
  async markFailed(id: string, errorCode: string, errorMessage: string): Promise<void> { ... }

  private getQueue(type: TaskType): Queue {
    switch (type) {
      case 'compress':
      case 'convert':
        return this.imageQueue;
      case 'pdf_merge':
      case 'pdf_split':
        return this.pdfQueue;
      case 'font_convert':
        return this.fontQueue;
    }
  }
}
```

### 8.3 实现 TasksController

`apps/api/src/modules/tasks/tasks.controller.ts`:
```typescript
@Controller('tasks')
@ApiTags('tasks')
@ApiBearerAuth()
export class TasksController {
  @Post()
  create(@Body() dto: CreateTaskDto, @CurrentUser() user?: User) {
    return this.tasksService.create(dto, user?.id);
  }

  @Get(':id')
  getOne(@Param('id') id: string, @CurrentUser() user?: User) { ... }

  @Get(':id/status')
  getStatus(@Param('id') id: string) {
    // 轻量接口，仅返回 status + progress，供前端轮询
  }

  @Get()
  list(@Query() query: TaskQueryDto, @CurrentUser() user: User) { ... }
}
```

### 8.4 创建 DTOs

`apps/api/src/modules/tasks/dto/`:
- `create-task.dto.ts` (用 @utils-plane/validators 的 schema)
- `task-query.dto.ts`
- `task-response.dto.ts`

### 8.5 实时进度更新（可选）

如果要支持 SSE 推送进度，添加：
```typescript
@Sse(':id/progress')
progress(@Param('id') id: string): Observable<MessageEvent> {
  // 订阅 Bull job progress event，推送到客户端
}
```

否则前端轮询 `/tasks/:id/status` 即可。

## 验收标准

- [ ] POST /tasks 创建任务，DB 有记录，队列有 job
- [ ] GET /tasks/:id 返回任务详情
- [ ] GET /tasks/:id/status 返回 status + progress
- [ ] GET /tasks 分页列表正常
- [ ] 越权访问 → 403
