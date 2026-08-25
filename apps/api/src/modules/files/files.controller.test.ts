import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Response } from 'express';
import { FilesController } from './files.controller';
import type { FilesService } from './files.service';

describe('FilesController route order', () => {
  it('declares static trash routes before dynamic id routes', () => {
    const source = readFileSync(
      join(import.meta.dir, 'files.controller.ts'),
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
      join(import.meta.dir, 'files.controller.ts'),
      'utf8'
    );
    const dtoSource = readFileSync(
      join(import.meta.dir, 'dto', 'file-ids.dto.ts'),
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
      join(import.meta.dir, 'files.service.ts'),
      'utf8'
    );

    expect(source).toContain("'text/markdown'");
    expect(source).toContain(
      "'application/vnd.openxmlformats-officedocument.wordprocessingml.document'"
    );
  });

  it('passes the current user into file upload entitlement checks', () => {
    const source = readFileSync(
      join(import.meta.dir, 'files.controller.ts'),
      'utf8'
    );

    expect(source).toContain('user');
    expect(source).toContain('this.filesService.upload(');
    expect(source).toContain('user ?? null');
  });

  it('uses shared entitlement upload limits instead of local constants', () => {
    const source = readFileSync(
      join(import.meta.dir, 'files.service.ts'),
      'utf8'
    );

    expect(source).toContain("getLimit(entitlementUser, 'upload.maxFileSize')");
    expect(source).not.toContain('ANONYMOUS_MAX_SIZE');
    expect(source).not.toContain('USER_MAX_SIZE');
  });

  it('uses the shared highest plan upload limit for the Multer transport cap', () => {
    const source = readFileSync(
      join(import.meta.dir, 'files.controller.ts'),
      'utf8'
    );

    expect(source).toContain("import { getLimit } from '@utils-plane/utils'");
    expect(source).toContain('const MAX_UPLOAD_TRANSPORT_SIZE = getLimit(');
    expect(source).toContain("plan: 'private'");
    expect(source).toContain('limits: { fileSize: MAX_UPLOAD_TRANSPORT_SIZE }');
    expect(source).not.toContain('50 * 1024 * 1024');
  });

  it('only accepts a user object or null for upload entitlement checks', () => {
    const source = readFileSync(
      join(import.meta.dir, 'files.service.ts'),
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
});

describe('FilesController download disposition', () => {
  function createController(file: { filename: string; mimeType: string }) {
    const service = {
      getById: async () => file,
      download: async () => Buffer.from('payload'),
      getSignedUrl: async () => 'https://signed.example/file',
    } as unknown as FilesService;

    return new FilesController(service);
  }

  function createResponse() {
    const headers = new Map<string, string>();
    const res = {
      setHeader: (name: string, value: string) => {
        headers.set(name, value);
        return res;
      },
      end: (body: unknown) => body,
    };

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
