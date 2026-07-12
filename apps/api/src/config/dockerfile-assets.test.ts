import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';

describe('Dockerfile runtime assets', () => {
  it('copies portrait segmentation ONNX models into the runtime image', () => {
    const source = readFileSync(join(process.cwd(), 'Dockerfile'), 'utf8');

    expect(source).toContain(
      'COPY --from=builder /app/apps/api/models ./models'
    );
  });

  it('builds and copies the shared utils package into runtime images', () => {
    const dockerfiles = [
      readFileSync(join(process.cwd(), 'Dockerfile'), 'utf8'),
      readFileSync(join(process.cwd(), 'apps/api/Dockerfile'), 'utf8'),
    ];

    for (const source of dockerfiles) {
      expect(source).toContain('packages/utils/tsconfig.json');
      expect(source).toContain(
        'COPY --from=builder /app/packages/utils/package.json ./packages/utils/package.json'
      );
      expect(source).toContain(
        'COPY --from=builder /app/packages/utils/dist-cjs ./packages/utils/dist-cjs'
      );
      expect(source).toContain("patch('packages/utils/package.json'");
    }
  });
});
