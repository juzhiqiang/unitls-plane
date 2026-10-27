import { describe, expect, it } from 'bun:test';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { BullModule } from '@nestjs/bullmq';
import { BullBoardModule } from '@bull-board/nestjs';
import { APP_GUARD } from '@nestjs/core';
import { AppModule } from '../../../src/app.module';
import { ApiAppModule } from '../../../src/api-app.module';
import { WorkerAppModule } from '../../../src/worker-app.module';
import { FilesModule } from '../../../src/modules/files/files.module';
import { FontsController } from '../../../src/modules/tasks/fonts.controller';
import { TasksController } from '../../../src/modules/tasks/tasks.controller';
import { TasksApiModule } from '../../../src/modules/tasks/tasks-api.module';
import { TasksCoreModule } from '../../../src/modules/tasks/tasks-core.module';
import { TasksWorkerModule } from '../../../src/modules/tasks/tasks-worker.module';
import { TasksModule } from '../../../src/modules/tasks/tasks.module';
import { AiImageProcessor } from '../../../src/modules/tasks/processors/ai-image.processor';
import { CleanupProcessor } from '../../../src/modules/tasks/processors/cleanup.processor';
import { CleanupScheduler } from '../../../src/modules/tasks/processors/cleanup.scheduler';
import { FontProcessor } from '../../../src/modules/tasks/processors/font.processor';
import { ImageProcessor } from '../../../src/modules/tasks/processors/image.processor';
import { PdfProcessor } from '../../../src/modules/tasks/processors/pdf.processor';
import { FontService } from '../../../src/modules/tasks/services/font.service';
import { ImageGeneratePresetsService } from '../../../src/modules/tasks/services/image-generate-presets.service';
import { ImageGenerationService } from '../../../src/modules/tasks/services/image-generation.service';
import { TasksService } from '../../../src/modules/tasks/tasks.service';

const processors = [
  ImageProcessor,
  PdfProcessor,
  FontProcessor,
  AiImageProcessor,
  CleanupProcessor,
  CleanupScheduler,
];

function metadata(key: string, target: object): unknown[] {
  return (Reflect.getMetadata(key, target) as unknown[] | undefined) ?? [];
}

function importedModules(target: object): unknown[] {
  return metadata(MODULE_METADATA.IMPORTS, target).map(imported =>
    typeof imported === 'function'
      ? imported
      : (imported as { module?: unknown }).module
  );
}

function providerTokens(target: object): unknown[] {
  return metadata(MODULE_METADATA.PROVIDERS, target).map(provider =>
    typeof provider === 'function'
      ? provider
      : (provider as { provide?: unknown }).provide
  );
}

describe('task module composition', () => {
  it('keeps shared services and queues in the core module', () => {
    const providers = metadata(MODULE_METADATA.PROVIDERS, TasksCoreModule);
    const exports = metadata(MODULE_METADATA.EXPORTS, TasksCoreModule);

    expect(providers).toContain(TasksService);
    expect(providers).toContain(FontService);
    expect(providers).toContain(ImageGenerationService);
    expect(providers).toContain(ImageGeneratePresetsService);
    for (const processor of processors) {
      expect(providers).not.toContain(processor);
    }

    expect(importedModules(TasksCoreModule)).toContain(FilesModule);
    expect(exports).toContain(FilesModule);
    expect(exports).toContain(TasksService);
    expect(exports).toContain(FontService);
    expect(exports).toContain(ImageGenerationService);
    expect(exports).toContain(ImageGeneratePresetsService);
    expect(exports).toContain(BullModule);
  });

  it('puts HTTP controllers only in the API task module', () => {
    expect(metadata(MODULE_METADATA.CONTROLLERS, TasksApiModule)).toEqual([
      TasksController,
      FontsController,
    ]);
    expect(metadata(MODULE_METADATA.PROVIDERS, TasksApiModule)).toHaveLength(0);
  });

  it('puts processors and the cleanup scheduler only in the worker task module', () => {
    const providers = metadata(MODULE_METADATA.PROVIDERS, TasksWorkerModule);

    expect(
      metadata(MODULE_METADATA.CONTROLLERS, TasksWorkerModule)
    ).toHaveLength(0);
    for (const processor of processors) {
      expect(providers).toContain(processor);
    }
  });

  it('keeps the legacy all-in-one task module compatible', () => {
    const imports = metadata(MODULE_METADATA.IMPORTS, TasksModule);

    expect(imports).toContain(TasksCoreModule);
    expect(imports).toContain(TasksApiModule);
    expect(imports).toContain(TasksWorkerModule);
  });
});

describe('application root composition', () => {
  it('gives the API root HTTP guards and no task processors', () => {
    const imports = importedModules(ApiAppModule);
    const providers = providerTokens(ApiAppModule);

    expect(imports).toContain(TasksApiModule);
    expect(imports).not.toContain(TasksWorkerModule);
    expect(providers).toContain(APP_GUARD);
  });

  it('gives the worker root no HTTP controllers, guards or BullBoard', () => {
    const imports = importedModules(WorkerAppModule);

    expect(metadata(MODULE_METADATA.CONTROLLERS, WorkerAppModule)).toHaveLength(
      0
    );
    expect(providerTokens(WorkerAppModule)).not.toContain(APP_GUARD);
    expect(imports).toContain(TasksWorkerModule);
    expect(imports).not.toContain(TasksApiModule);
    expect(imports).not.toContain(BullBoardModule);
  });

  it('keeps AppModule as the API plus worker compatibility root', () => {
    const imports = importedModules(AppModule);

    expect(imports).toContain(ApiAppModule);
    expect(imports).toContain(WorkerAppModule);
  });
});
