import { describe, expect, it } from 'bun:test';
import {
  createCadWriter,
  DwgWriter,
  packageCadWriteResult,
} from '../../../../../src/modules/tasks/services/cad/cad-writer';
import { DxfWriter } from '../../../../../src/modules/tasks/services/cad/dxf-writer';
import { CadError } from '../../../../../src/modules/tasks/services/cad/types';

describe('createCadWriter', () => {
  it('returns the DXF writer for dxf and the DWG boundary for dwg', () => {
    expect(createCadWriter('dxf')).toBeInstanceOf(DxfWriter);
    expect(createCadWriter('dwg')).toBeInstanceOf(DwgWriter);
    expect(createCadWriter('dwg').format).toBe('dwg');
  });

  it('fails DWG output with CAD_DWG_UNSUPPORTED instead of producing a fake file', async () => {
    let caught: unknown;
    try {
      await new DwgWriter().write();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CadError);
    expect((caught as CadError).code).toBe('CAD_DWG_UNSUPPORTED');
    expect((caught as CadError).retryable).toBe(false);
  });
});

describe('packageCadWriteResult', () => {
  it('returns the DXF itself when there are no resources', async () => {
    const output = await packageCadWriteResult({
      format: 'dxf',
      primary: 'drawing.dxf',
      files: [
        {
          name: 'drawing.dxf',
          mimeType: 'application/dxf',
          data: Buffer.from('0\nEOF\n'),
        },
      ],
    });
    expect(output).toMatchObject({
      filename: 'drawing.dxf',
      mimeType: 'application/dxf',
      archived: false,
    });
    expect(output.data.toString()).toBe('0\nEOF\n');
  });

  it('zips the DXF together with underlay resources', async () => {
    const output = await packageCadWriteResult({
      format: 'dxf',
      primary: 'drawing.dxf',
      files: [
        {
          name: 'drawing.dxf',
          mimeType: 'application/dxf',
          data: Buffer.from('0\nEOF\n'),
        },
        {
          name: 'drawing-page-1-1.png',
          mimeType: 'image/png',
          data: Buffer.from('PNG'),
        },
      ],
    });
    expect(output).toMatchObject({
      filename: 'drawing.zip',
      mimeType: 'application/zip',
      archived: true,
    });
    // ZIP 本地文件头签名 + 中央目录里的文件名。
    expect(output.data.subarray(0, 4)).toEqual(
      Buffer.from([0x50, 0x4b, 0x03, 0x04])
    );
    expect(output.data.includes('drawing.dxf')).toBe(true);
    expect(output.data.includes('drawing-page-1-1.png')).toBe(true);
  });

  it('rejects a result whose primary file is missing', async () => {
    await expect(
      packageCadWriteResult({
        format: 'dxf',
        primary: 'drawing.dxf',
        files: [],
      })
    ).rejects.toMatchObject({ code: 'CAD_CONVERSION_FAILED' });
  });
});
