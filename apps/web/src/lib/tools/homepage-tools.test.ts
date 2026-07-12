import { describe, expect, it } from 'vitest';
import { createHomepageQuickTools } from './homepage-tools';

describe('createHomepageQuickTools', () => {
  it('keeps the homepage focused on four high-value entry points', () => {
    const tools = createHomepageQuickTools();

    expect(tools).toHaveLength(4);
    expect(tools.map(tool => tool.key)).toEqual([
      'imageCompress',
      'imageStitch',
      'pdfFromDocument',
      'imageAnimation',
    ]);
  });
});
