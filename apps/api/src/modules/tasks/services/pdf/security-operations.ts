import { PDFDocument, type SecurityOptions } from '@cantoo/pdf-lib';
import { getMupdf } from './mupdf-runtime';
import type { EncryptOptions, CompressPdfOptions } from './options.type';

export class PdfSecurityOperations {
  async encrypt(input: Buffer, opts: EncryptOptions): Promise<Buffer> {
    // 之前用 mupdf 的 saveToBuffer 传两个参数且 mupdf wasm 根本不支持加密写入，
    // 导致产物未加密却返回成功。这里改用 @cantoo/pdf-lib 的 encrypt() 真正加密。
    const doc = await PDFDocument.load(input);
    try {
      const perms = opts.permissions ?? {};
      const permissions: SecurityOptions['permissions'] = {
        printing: perms.print === false ? false : 'highResolution',
        modifying: perms.modify === false ? false : true,
        copying: perms.copy === false ? false : true,
        annotating: perms.annotate === false ? false : true,
      };

      const security: SecurityOptions = {
        ownerPassword: opts.ownerPassword,
        userPassword: opts.userPassword ?? '',
        permissions,
      };

      doc.encrypt(security);
      const result = await doc.save();
      return Buffer.from(result);
    } finally {
      // cantoo/pdf-lib 在 save() 后会自动 flush，无需手动 cleanup
    }
  }

  async compressPdf(input: Buffer, opts: CompressPdfOptions): Promise<Buffer> {
    const mupdf = await getMupdf();

    if (opts.level === 'light') {
      const doc = mupdf.Document.openDocument(
        input,
        'application/pdf'
      ) as import('mupdf').PDFDocument;
      try {
        const result = doc.saveToBuffer('compress,garbage=4,linearize');
        try {
          return Buffer.from(result.asUint8Array());
        } finally {
          result.destroy();
        }
      } finally {
        doc.destroy();
      }
    }

    const dpi = opts.level === 'medium' ? 150 : 100;
    const quality = opts.level === 'medium' ? 75 : 50;
    const scale = dpi / 72;

    const srcDoc = mupdf.Document.openDocument(input, 'application/pdf');
    try {
      const newDoc = await PDFDocument.create();
      for (let i = 0; i < srcDoc.countPages(); i++) {
        const page = srcDoc.loadPage(i);
        try {
          const pixmap = page.toPixmap(
            mupdf.Matrix.scale(scale, scale),
            mupdf.ColorSpace.DeviceRGB
          );
          try {
            const jpegData = pixmap.asJPEG(quality);
            const jpgImage = await newDoc.embedJpg(Buffer.from(jpegData));

            const bounds = page.getBounds();
            const pageWidth = bounds[2] - bounds[0];
            const pageHeight = bounds[3] - bounds[1];

            const newPage = newDoc.addPage([pageWidth, pageHeight]);
            newPage.drawImage(jpgImage, {
              x: 0,
              y: 0,
              width: pageWidth,
              height: pageHeight,
            });
          } finally {
            pixmap.destroy();
          }
        } finally {
          page.destroy();
        }
      }

      return Buffer.from(await newDoc.save());
    } finally {
      srcDoc.destroy();
    }
  }
}
