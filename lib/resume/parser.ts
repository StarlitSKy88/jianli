/**
 * 简历解析器 — 支持 PDF / DOCX / TXT / MD / 图片 (OCR)
 *
 * 设计：
 * - 按 MIME/扩展名分发到具体 parser
 * - 失败 fallback 到 "原文全文"
 * - 输出标准化 ParsedResume
 */
// NOTE: pdf-parse 与 mammoth 顶层 import，避免 pdfjs-dist ESM 不兼容时把整条
// /api/resume/upload 路线炸成 500（连 401 路径都走不到）。
import mammoth from 'mammoth';
// pdfParse: dynamic import inside handler only (see `loadPdfParse`).

export interface ParsedResume {
  rawText: string;
  format: string;
  pages?: number;
  warnings: string[];
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const TEXT_MIME = new Set(['text/plain', 'text/markdown', 'text/html', 'application/x-markdown']);

const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

const MIME_TO_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
};

export class ResumeParseError extends Error {
  constructor(msg: string) {
    super(`[resume-parser] ${msg}`);
  }
}

type PdfParseFn = (buffer: Buffer) => Promise<{ text: string; numpages: number }>;
let _pdfParseP: Promise<PdfParseFn> | null = null;

function loadPdfParse(): Promise<PdfParseFn> {
  if (!_pdfParseP) {
    _pdfParseP = import('pdf-parse')
      .then((m) => {
        const fn = (m as unknown as { default?: PdfParseFn }).default;
        if (!fn) throw new Error('pdf-parse: no default export');
        return fn as PdfParseFn;
      })
      .catch((e) => {
        _pdfParseP = null; // 下次重试
        throw e;
      });
  }
  return _pdfParseP;
}

export async function parseResume(
  buffer: Buffer,
  mime: string,
  fileName: string
): Promise<ParsedResume> {
  if (buffer.length > MAX_FILE_SIZE) {
    throw new ResumeParseError(`文件超过 5MB: ${buffer.length} bytes`);
  }
  if (buffer.length === 0) {
    throw new ResumeParseError('空文件');
  }

  const ext = (MIME_TO_EXT[mime] || fileName.split('.').pop() || '').toLowerCase();

  // 文本类
  if (TEXT_MIME.has(mime) || ['txt', 'md', 'markdown'].includes(ext)) {
    return {
      rawText: buffer.toString('utf8'),
      format: ext || 'txt',
      warnings: [],
    };
  }

  // PDF (dynamic import — pdfjs-dist 5 ESM 与 webpack dev 服不兼容，必须 lazy)
  if (mime === 'application/pdf' || ext === 'pdf') {
    try {
      const pdfParse = await loadPdfParse();
      const data = await pdfParse(buffer);
      return {
        rawText: data.text,
        format: 'pdf',
        pages: data.numpages,
        warnings: [],
      };
    } catch (e) {
      throw new ResumeParseError(`PDF 解析失败: ${(e as Error).message}`);
    }
  }

  // DOCX
  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'docx' ||
    ext === 'doc'
  ) {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return {
        rawText: result.value,
        format: 'docx',
        warnings: result.messages.map((m) => m.message),
      };
    } catch (e) {
      throw new ResumeParseError(`DOCX 解析失败: ${(e as Error).message}`);
    }
  }

  // 图片 OCR（动态 import tesseract.js 因为很重）
  if (IMAGE_MIME.has(mime) || ['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
    try {
      const tess = await import('tesseract.js');
      const { data } = await tess.default.recognize(buffer, 'chi_sim+eng');
      return {
        rawText: data.text,
        format: ext,
        warnings: [],
      };
    } catch (e) {
      throw new ResumeParseError(`OCR 失败: ${(e as Error).message}`);
    }
  }

  throw new ResumeParseError(`不支持的格式: mime=${mime} ext=${ext}`);
}
