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
});
