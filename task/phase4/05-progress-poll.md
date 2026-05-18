# 05 - 任务进度轮询 Hook

> 依赖：Phase 2 / 08-tasks-module
> 预估：1h
> 可并行：与 01/02 同时执行

## 目标

封装 React hook，轮询任务状态直到完成或失败，自动处理 progress、error。

## 步骤

### 5.1 创建 useTaskProgress hook

`src/hooks/api/use-task-progress.ts`:

```typescript
'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export interface TaskProgress {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  outputFileId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export function useTaskProgress(
  taskId: string | null,
  options?: {
    pollingInterval?: number;
    onCompleted?: (outputFileId: string) => void;
    onFailed?: (error: { code: string; message: string }) => void;
  }
) {
  const interval = options?.pollingInterval ?? 1000;

  return useQuery({
    queryKey: ['task-progress', taskId],
    queryFn: async () => {
      if (!taskId) return null;
      const { data, error } = await api.GET('/tasks/{id}/status', {
        params: { path: { id: taskId } },
      });
      if (error) throw error;
      return data as TaskProgress;
    },
    enabled: !!taskId,
    refetchInterval: query => {
      const data = query.state.data;
      if (!data) return interval;
      if (data.status === 'completed' || data.status === 'failed') {
        return false; // 停止轮询
      }
      return interval;
    },
    refetchIntervalInBackground: false,
  });
}
```

### 5.2 添加副作用监听

```typescript
import { useEffect } from 'react';

export function useTaskProgress(...) {
  const query = useQuery({...});

  useEffect(() => {
    if (!query.data) return;
    if (query.data.status === 'completed' && query.data.outputFileId) {
      options?.onCompleted?.(query.data.outputFileId);
    } else if (query.data.status === 'failed') {
      options?.onFailed?.({
        code: query.data.errorCode ?? 'UNKNOWN',
        message: query.data.errorMessage ?? 'Task failed',
      });
    }
  }, [query.data?.status]);

  return query;
}
```

### 5.3 提供 waitForTask 工具函数

`src/lib/api/wait-for-task.ts`:

```typescript
import { api } from '@/lib/api-client';

export async function waitForTask(
  taskId: string,
  options?: {
    timeoutMs?: number;
    pollingInterval?: number;
    onProgress?: (progress: number) => void;
  }
): Promise<{ outputFileId: string }> {
  const startedAt = Date.now();
  const timeout = options?.timeoutMs ?? 5 * 60 * 1000;
  const interval = options?.pollingInterval ?? 1000;

  while (true) {
    if (Date.now() - startedAt > timeout) {
      throw new Error('Task timeout');
    }

    const { data, error } = await api.GET('/tasks/{id}/status', {
      params: { path: { id: taskId } },
    });
    if (error) throw error;

    options?.onProgress?.(data.progress);

    if (data.status === 'completed') {
      return { outputFileId: data.outputFileId! };
    }
    if (data.status === 'failed') {
      throw new Error(data.errorMessage ?? 'Task failed');
    }

    await new Promise(resolve => setTimeout(resolve, interval));
  }
}
```

### 5.4 SSE 版本（可选优化）

如果后端实现了 `/tasks/:id/progress` SSE 端点：

```typescript
export function useTaskProgressSSE(taskId: string | null) {
  const [progress, setProgress] = useState<TaskProgress | null>(null);

  useEffect(() => {
    if (!taskId) return;
    const eventSource = new EventSource(`${API_URL}/tasks/${taskId}/progress`);
    eventSource.onmessage = e => setProgress(JSON.parse(e.data));
    return () => eventSource.close();
  }, [taskId]);

  return progress;
}
```

### 5.5 单元测试

`src/hooks/api/__tests__/use-task-progress.test.ts`:

- 轮询间隔正确
- completed 状态停止轮询
- failed 状态停止轮询并触发回调

## 验收标准

- [ ] 任务从 pending → processing → completed 全程进度更新
- [ ] 完成后自动停止轮询
- [ ] 失败时触发 onFailed 回调
- [ ] taskId 为 null 时不发起请求
- [ ] 切换页面时停止轮询（React Query 默认行为）
