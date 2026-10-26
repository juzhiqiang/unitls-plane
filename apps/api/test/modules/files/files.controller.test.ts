import { describe, expect, it, vi } from 'bun:test';
import { readFileSync } from 'node:fs';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Response } from 'express';
import { FilesController } from '../../../src/modules/files/files.controller';
import type { FilesService } from '../../../src/modules/files/files.service';
import { ensureUploadTempDir } from '../../../src/modules/files/upload-temp-file';
import { EventEmitter } from 'node:events';
import { PassThrough, Readable, Writable } from 'node:stream';

describe('FilesController route order', () => {
  it('declares static trash routes before dynamic id routes', () => {
    const source = readFileSync(
      join(
        import.meta.dir,
        '../../../src/modules/files/',
        'files.controller.ts'
      ),
      'utf8'
    );

    const idRouteIndex = source.indexOf("@Get(':id')");
    expect(idRouteIndex).toBeGreaterThanOrEqual(0);

    for (const route of [
      "@Get('trash')",
      "@Delete('trash/empty')",
      "@Post('batch-restore')",
      "@Post('batch-permanent-delete')",
      "@Post('batch-delete')",
    ]) {
      const routeIndex = source.indexOf(route);
      expect(routeIndex, route).toBeGreaterThanOrEqual(0);
      expect(routeIndex, route).toBeLessThan(idRouteIndex);
    }
  });

  it('uses a class-validator DTO for batch file id requests', () => {
    const controllerSource = readFileSync(
      join(
        import.meta.dir,
        '../../../src/modules/files/',
        'files.controller.ts'
      ),
      'utf8'
    );
    const dtoSource = readFileSync(
      join(
        import.meta.dir,
        '../../../src/modules/files/',
        'dto',
        'file-ids.dto.ts'
      ),
      'utf8'
    );

    expect(controllerSource).toContain(
      "import { FileIdsDto } from './dto/file-ids.dto'"
    );
    expect(controllerSource).toContain('@Body() body: FileIdsDto');
    expect(controllerSource).not.toContain('private validateIds');
    expect(dtoSource).toContain('export class FileIdsDto');
    expect(dtoSource).toContain('@IsArray()');
    expect(dtoSource).toContain('@ArrayNotEmpty()');
    expect(dtoSource).toContain("@IsUUID('4', { each: true })");
  });

  it('allows document source mime types used by Markdown and Word to PDF', () => {
    const source = readFileSync(
      join(import.meta.dir, '../../../src/modules/files/', 'files.service.ts'),
      'utf8'
    );

    expect(source).toContain("'text/markdown'");
    expect(source).toContain(
      "'application/vnd.openxmlformats-officedocument.wordprocessingml.document'"
    );
  });

  it('passes the current user into file upload entitlement checks', () => {
    const source = readFileSync(
      join(
        import.meta.dir,
        '../../../src/modules/files/',
        'files.controller.ts'
      ),
      'utf8'
    );

    expect(source).toContain('user');
    expect(source).toContain('this.filesService.upload(');
    expect(source).toContain('user ?? null');
  });

  it('uses shared entitlement upload limits instead of local constants', () => {
    const source = readFileSync(
      join(import.meta.dir, '../../../src/modules/files/', 'files.service.ts'),
      'utf8'
    );

    expect(source).toContain("getLimit(entitlementUser, 'upload.maxFileSize')");
    expect(source).not.toContain('ANONYMOUS_MAX_SIZE');
    expect(source).not.toContain('USER_MAX_SIZE');
  });

  it('uses the shared highest plan upload limit for the Multer transport cap', () => {
    const source = readFileSync(
      join(
        import.meta.dir,
        '../../../src/modules/files/',
        'files.controller.ts'
      ),
      'utf8'
    );

    expect(source).toContain("import { getLimit } from '@utils-plane/utils'");
    expect(source).toContain('const MAX_UPLOAD_TRANSPORT_SIZE = getLimit(');
    expect(source).toContain("plan: 'private'");
    expect(source).toContain('fileSize: MAX_UPLOAD_TRANSPORT_SIZE');
    expect(
      source.indexOf(
        'UploadBudgetInterceptor,',
        source.indexOf('@UseInterceptors(')
      )
    ).toBeLessThan(source.indexOf("FileInterceptor('file'"));
    expect(source).not.toContain('50 * 1024 * 1024');
  });

  it('only accepts a user object or null for upload entitlement checks', () => {
    const source = readFileSync(
      join(import.meta.dir, '../../../src/modules/files/', 'files.service.ts'),
      'utf8'
    );
    const uploadStart = source.indexOf('async upload(');
    const uploadEnd = source.indexOf('async getById(');
    const uploadSource = source.slice(uploadStart, uploadEnd);

    expect(uploadStart).toBeGreaterThanOrEqual(0);
    expect(uploadEnd).toBeGreaterThan(uploadStart);
    expect(uploadSource).toContain(
      "user: Pick<User, 'id' | 'plan' | 'role'> | null"
    );
    expect(uploadSource).not.toContain(
      "user?: Pick<User, 'id' | 'plan' | 'role'> | null"
    );
    expect(uploadSource).not.toContain('userId?: string): Promise<File>');
    expect(uploadSource).not.toContain(
      "Pick<User, 'id' | 'plan' | 'role'> | string | null"
    );
    expect(uploadSource).not.toContain("typeof uploadUser === 'string'");
  });

  it('passes a disk-backed upload and removes the temp file when service fails', async () => {
    const directory = mkdtempSync(
      join(ensureUploadTempDir(), 'utils-plane-controller-')
    );
    const path = join(directory, 'upload.bin');
    writeFileSync(path, 'payload');
    const service = {
      upload: vi.fn(async (input: unknown) => {
        expect(input).toEqual({ path, size: 7 });
        throw new Error('storage unavailable');
      }),
    } as unknown as FilesService;
    const controller = new FilesController(service);

    await expect(
      controller.upload(
        {
          originalname: 'upload.bin',
          mimetype: 'application/octet-stream',
          size: 7,
          path,
        } as never,
        null as never
      )
    ).rejects.toThrow('storage unavailable');

    expect(existsSync(path)).toBe(false);
  });

  it('aborts the service upload when the request closes before its body ends', async () => {
    const directory = ensureUploadTempDir();
    const path = join(directory, `controller-close-${Date.now()}`);
    writeFileSync(path, 'payload');
    const request = Object.assign(new EventEmitter(), {
      readableEnded: false,
      destroyed: false,
    });
    let resolveUpload!: () => void;
    const uploadFinished = new Promise<void>(resolve => {
      resolveUpload = resolve;
    });
    let receivedSignal: globalThis.AbortSignal | undefined;
    const service = {
      upload: vi.fn(
        async (
          _input: unknown,
          _meta: unknown,
          _user: unknown,
          signal?: globalThis.AbortSignal
        ) => {
          receivedSignal = signal;
          await uploadFinished;
          return {};
        }
      ),
    } as unknown as FilesService;
    const controller = new FilesController(service);

    const pending = controller.upload(
      {
        originalname: 'upload.bin',
        mimetype: 'application/octet-stream',
        size: 7,
        path,
      } as never,
      null as never,
      request as never
    );

    await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    request.emit('close');
    expect(receivedSignal?.aborted).toBe(true);
    resolveUpload();
    await pending;
    expect(existsSync(path)).toBe(false);
  });
});

describe('FilesController list pagination options', () => {
  function createController() {
    const service = {
      listByUser: vi.fn().mockResolvedValue({
        files: [],
        total: null,
        nextCursor: null,
      }),
      listTrashed: vi.fn().mockResolvedValue({
        files: [],
        total: null,
        nextCursor: null,
      }),
    } as unknown as FilesService;

    return { controller: new FilesController(service), service };
  }

  it('forwards cursor-only mode to the active file list', async () => {
    const { controller, service } = createController();
    const user = { id: 'user-1' } as never;

    await controller.list(
      undefined,
      '20',
      undefined,
      undefined,
      user,
      'cursor-1',
      'false'
    );

    expect(service.listByUser).toHaveBeenCalledWith('user-1', {
      page: undefined,
      limit: 20,
      cursor: 'cursor-1',
      mimeType: undefined,
      search: undefined,
      includeTotal: false,
    });
  });

  it('forwards cursor-only mode to the trash list', async () => {
    const { controller, service } = createController();
    const user = { id: 'user-1' } as never;

    await controller.listTrash(undefined, undefined, user, 'cursor-1', 'false');

    expect(service.listTrashed).toHaveBeenCalledWith('user-1', {
      page: undefined,
      limit: undefined,
      cursor: 'cursor-1',
      includeTotal: false,
    });
  });

  it('rejects an invalid includeTotal query value', async () => {
    const { controller, service } = createController();
    const user = { id: 'user-1' } as never;

    await expect(
      controller.list(
        undefined,
        undefined,
        undefined,
        undefined,
        user,
        undefined,
        'sometimes'
      )
    ).rejects.toThrow('Invalid includeTotal');
    expect(service.listByUser).not.toHaveBeenCalled();
  });
});

describe('FilesController download disposition', () => {
  function createController(file: { filename: string; mimeType: string }) {
    const service = {
      getById: async () => ({ ...file, originalSize: 7 }),
      downloadStream: async () => Readable.from(Buffer.from('payload')),
      getSignedUrl: async () => 'https://signed.example/file',
    } as unknown as FilesService;

    return new FilesController(service);
  }

  function createResponse() {
    const headers = new Map<string, string>();
    const res = Object.assign(
      new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      }),
      {
        setHeader: (name: string, value: string) => {
          headers.set(name, value);
          return res;
        },
      }
    );

    return { res: res as unknown as Response, headers };
  }

  it('previews inline when no download flag is provided', async () => {
    const controller = createController({
      filename: 'avatar.png',
      mimeType: 'image/png',
    });
    const { res, headers } = createResponse();

    await controller.download('file-1', undefined, undefined, res);

    expect(headers.get('Content-Type')).toBe('image/png');
    expect(headers.get('Content-Disposition')).toStartWith('inline;');
  });

  it('forces an attachment download when download=1', async () => {
    const controller = createController({
      filename: '发票.pdf',
      mimeType: 'application/pdf',
    });
    const { res, headers } = createResponse();

    await controller.download('file-2', '1', undefined, res);

    expect(headers.get('Content-Disposition')).toBe(
      'attachment; filename="__.pdf"; filename*=UTF-8\'\'%E5%8F%91%E7%A5%A8.pdf'
    );
    expect(headers.get('Content-Length')).toBe('7');
  });
});

describe('FilesController stream lifecycle', () => {
  function setup(source: Readable) {
    const controller = new FilesController({
      getById: async () => ({
        storageKey: 'key',
        filename: 'a.pdf',
        mimeType: 'application/pdf',
        originalSize: 7,
      }),
      downloadStream: async () => source,
    } as unknown as FilesService);
    const res = Object.assign(
      new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      }),
      { setHeader() {} }
    );
    return {
      res,
      run: () =>
        controller.download(
          'id',
          undefined,
          undefined,
          res as unknown as Response
        ),
    };
  }
  it('destroys the response when the source fails', async () => {
    const source = new PassThrough();
    const { res, run } = setup(source);
    const pending = run().catch(error => error as Error);
    await new Promise(resolve => setTimeout(resolve, 10));
    source.destroy(new Error('source failed'));
    expect((await pending)?.message).toBe('source failed');
    expect(res.destroyed).toBe(true);
  });
  it('destroys the source when the client disconnects', async () => {
    const source = new PassThrough();
    const { res, run } = setup(source);
    const pending = run().catch(error => error as Error);
    await new Promise(resolve => setTimeout(resolve, 10));
    res.destroy();
    expect(await pending).toBeInstanceOf(Error);
    expect(source.destroyed).toBe(true);
  });
});

describe('FilesController thumbnail', () => {
  const etag = '"thumb-file-1-320-1"';

  function createController(file: {
    id: string;
    mimeType: string;
    originalSize: number;
  }) {
    const getById = vi.fn(async () => ({
      ...file,
      storageKey: 'user-1/f/x.png',
    }));
    const thumbnail = vi.fn(async () => Buffer.from('webp-bytes'));
    const service = { getById, thumbnail } as unknown as FilesService;

    return {
      controller: new FilesController(service),
      getById,
      thumbnail,
    };
  }

  function createResponse() {
    const headers = new Map<string, string>();
    const state: { statusCode: number; body: unknown } = {
      statusCode: 200,
      body: undefined,
    };
    const res = {
      setHeader: (name: string, value: string) => {
        headers.set(name, value);
        return res;
      },
      status: (code: number) => {
        state.statusCode = code;
        return res;
      },
      end: (body?: unknown) => {
        state.body = body;
        return res;
      },
    };

    return { res: res as unknown as Response, headers, state };
  }

  it('serves a cacheable webp thumbnail for images', async () => {
    const { controller, thumbnail } = createController({
      id: 'file-1',
      mimeType: 'image/png',
      // 生图产物的量级:以前网格按体积退化成图标,现在服务端缩完再发。
      originalSize: 3 * 1024 * 1024,
    });
    const { res, headers, state } = createResponse();

    await controller.thumbnail('file-1', undefined, undefined, res);

    expect(headers.get('Content-Type')).toBe('image/webp');
    expect(headers.get('Cache-Control')).toBe('private, max-age=86400');
    expect(headers.get('ETag')).toBe(etag);
    expect(state.statusCode).toBe(200);
    expect(thumbnail).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'file-1',
        storageKey: 'user-1/f/x.png',
      })
    );
  });

  it('returns an empty 304 before loading or rendering the thumbnail', async () => {
    const { controller, getById, thumbnail } = createController({
      id: 'file-1',
      mimeType: 'image/png',
      originalSize: 3 * 1024 * 1024,
    });
    const { res, headers, state } = createResponse();

    await controller.thumbnail(
      'file-1',
      'W/"thumb-file-1-320-1", "other"',
      undefined,
      res
    );

    expect(getById).toHaveBeenCalledTimes(1);
    expect(thumbnail).not.toHaveBeenCalled();
    expect(state.statusCode).toBe(304);
    expect(state.body).toBeUndefined();
    expect(headers.get('ETag')).toBe(etag);
    expect(headers.get('Cache-Control')).toBe('private, max-age=86400');
    expect(headers.has('Content-Type')).toBe(false);
    expect(headers.has('Content-Length')).toBe(false);
  });

  it('passes the current user through access control before a 304', async () => {
    const { controller, getById, thumbnail } = createController({
      id: 'file-1',
      mimeType: 'image/png',
      originalSize: 1024,
    });
    const { res, state } = createResponse();
    const user = { id: 'user-1' } as never;

    await controller.thumbnail('file-1', etag, user, res);

    expect(getById).toHaveBeenCalledWith('file-1', 'user-1');
    expect(thumbnail).not.toHaveBeenCalled();
    expect(state.statusCode).toBe(304);
  });

  it('does not bypass access control when the thumbnail ETag matches', async () => {
    const denied = new Error('not found');
    const thumbnail = vi.fn();
    const service = {
      getById: vi.fn().mockRejectedValue(denied),
      thumbnail,
    } as unknown as FilesService;
    const controller = new FilesController(service);
    const { res } = createResponse();

    await expect(
      controller.thumbnail('file-1', etag, undefined, res)
    ).rejects.toBe(denied);
    expect(thumbnail).not.toHaveBeenCalled();
  });

  it('refuses types it cannot rasterise', async () => {
    const { controller, thumbnail } = createController({
      id: 'file-2',
      mimeType: 'application/pdf',
      originalSize: 1024,
    });
    const { res } = createResponse();

    await expect(
      controller.thumbnail('file-2', undefined, undefined, res)
    ).rejects.toThrow();
    expect(thumbnail).not.toHaveBeenCalled();
  });

  it('refuses originals too large to decode', async () => {
    const { controller, thumbnail } = createController({
      id: 'file-3',
      mimeType: 'image/png',
      originalSize: 64 * 1024 * 1024,
    });
    const { res } = createResponse();

    await expect(
      controller.thumbnail('file-3', undefined, undefined, res)
    ).rejects.toThrow();
    expect(thumbnail).not.toHaveBeenCalled();
  });
});
