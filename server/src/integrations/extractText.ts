import { PDFParse } from 'pdf-parse';
import Tesseract, { PSM } from 'tesseract.js';
import sharp from 'sharp';
import { labelParseScore } from '../domain/parseLabel.js';

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
  const variants = await imageVariants(bytes);
  const worker = await Tesseract.createWorker('eng', 1, { cachePath });
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
    });
    let best = { text: '', score: -1 };
    for (const image of variants) {
      const result = await worker.recognize(image);
      const text = result.data.text ?? '';
      const score = labelParseScore(text);
      if (score > best.score) best = { text, score };
    }
    return best.text;
  } finally {
    await worker.terminate();
  }
}

async function imageVariants(bytes: Buffer): Promise<Buffer[]> {
  try {
    const rotated = sharp(bytes).rotate();
    const base = await rotated.greyscale().normalize().toBuffer();
    const left = await sharp(bytes).rotate().rotate(270).greyscale().normalize().toBuffer();
    const right = await sharp(bytes).rotate().rotate(90).greyscale().normalize().toBuffer();
    return uniqueBuffers([base, left, right, bytes]);
  } catch {
    return [bytes];
  }
}

function uniqueBuffers(buffers: Buffer[]): Buffer[] {
  const seen = new Set<string>();
  const out: Buffer[] = [];
  for (const buffer of buffers) {
    const key = `${buffer.length}:${buffer[0] ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(buffer);
  }
  return out;
}
