import { PDFParse } from 'pdf-parse';
import Tesseract from 'tesseract.js';

export async function extractPdfText(bytes: Buffer): Promise<string> {
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText();
    return result.text ?? '';
  } finally {
    await parser.destroy();
  }
}

export async function extractImageText(bytes: Buffer, cachePath: string): Promise<string> {
  const worker = await Tesseract.createWorker('eng', 1, { cachePath });
  try {
    const result = await worker.recognize(bytes);
    return result.data.text ?? '';
  } finally {
    await worker.terminate();
  }
}
