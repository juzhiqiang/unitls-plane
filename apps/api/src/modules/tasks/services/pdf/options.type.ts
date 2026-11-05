export interface SplitOptions {
  mode: 'ranges' | 'pages' | 'every';
  ranges?: [number, number][];
  pages?: number[];
  every?: number;
}

export interface ToTextOptions {
  format: 'markdown' | 'text';
  pages?: number[];
  pageBreak?: string;
}

export interface ImageToPdfOptions {
  pageSize?: 'original' | 'a4' | 'letter';
  fit?: 'fit' | 'fill' | 'stretch';
}

export interface RotateOptions {
  pages: number[];
  angle: 0 | 90 | 180 | 270;
}

export interface WatermarkOptions {
  text: string;
  fontSize?: number;
  opacity?: number;
  color?: { r: number; g: number; b: number };
  rotation?: number;
  position?: 'center' | 'diagonal';
}

export interface EncryptOptions {
  userPassword?: string;
  ownerPassword: string;
  permissions?: {
    print?: boolean;
    copy?: boolean;
    modify?: boolean;
    annotate?: boolean;
  };
}

export interface CompressPdfOptions {
  level: 'light' | 'medium' | 'heavy';
}

export interface PdfMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string[];
  creator?: string;
  producer?: string;
}

export interface RearrangeOptions {
  pageOrder: number[];
}

export interface DocumentToPdfOptions {
  sourceFormat: 'markdown' | 'docx';
  outputFilename?: string;
}
