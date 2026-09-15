import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface SchemaProperty {
  type?: string;
  format?: string;
  example?: unknown;
  nullable?: boolean;
}

interface OpenApiDocument {
  components: {
    schemas: {
      LiveHealthDto: {
        properties: Record<string, SchemaProperty>;
        required: string[];
      };
    };
  };
}

describe('LiveHealthDto OpenAPI contract', () => {
  it('uses buildCommit and allows a missing build time', () => {
    const document = JSON.parse(
      readFileSync(join(import.meta.dir, '../../../openapi.json'), 'utf8')
    ) as OpenApiDocument;
    const schema = document.components.schemas.LiveHealthDto;

    expect(schema.required).toContain('buildCommit');
    expect(schema.required).not.toContain('commit');
    expect(schema.properties).not.toHaveProperty('commit');
    expect(schema.properties.buildCommit).toMatchObject({
      type: 'string',
      example: 'dev',
    });
    expect(schema.properties.buildTime).toMatchObject({
      type: 'string',
      format: 'date-time',
      nullable: true,
    });
  });
});
