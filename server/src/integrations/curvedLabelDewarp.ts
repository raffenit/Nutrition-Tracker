import sharp from 'sharp';
import {
  detectCurvedRules,
  dewarpToStraightRules,
  maxRuleSpreadPx,
  type CurvedRule,
} from '../domain/curvedRuleDewarp.js';

/** Below this vertical spread per rule, the panel is already flat enough for OCR. */
const MIN_RULE_SPREAD_TO_DEWARP_PX = 4;
const MIN_RULES_TO_DEWARP = 3;

export type CurvedLabelDewarpResult = {
  /** Greyscale, normalized PNG with rules straightened (or the unwarped normalized input). */
  bytes: Buffer;
  rules: CurvedRule[];
  maxSpreadPx: number;
  applied: boolean;
};

/** Straighten curved row rules (cylindrical packaging) so rows OCR as flat text lines. */
export async function dewarpCurvedLabelRules(bytes: Buffer): Promise<CurvedLabelDewarpResult> {
  const { data, info } = await sharp(bytes).rotate().greyscale().normalize().raw().toBuffer({ resolveWithObject: true });
  const image = { data, width: info.width, height: info.height };
  const rules = detectCurvedRules(image);
  const maxSpreadPx = maxRuleSpreadPx(rules, info.width);
  const applied = rules.length >= MIN_RULES_TO_DEWARP && maxSpreadPx >= MIN_RULE_SPREAD_TO_DEWARP_PX;
  const pixels = applied ? dewarpToStraightRules(image, rules) : data;
  const png = await sharp(pixels, { raw: { width: info.width, height: info.height, channels: 1 } }).png().toBuffer();
  return { bytes: png, rules, maxSpreadPx, applied };
}

/** Cheap Tesseract inputs for a dewarped half/strip: 2× upscale plus contrast/gamma variants. */
export async function buildDewarpedStripOcrVariants(dewarped: Buffer): Promise<Buffer[]> {
  const meta = await sharp(dewarped).metadata();
  const width = meta.width ?? 0;
  const up = sharp(await sharp(dewarped).resize({ width: width * 2, kernel: 'lanczos3' }).png().toBuffer());
  return [
    await up.clone().png().toBuffer(),
    await up.clone().linear(1.4, -40).png().toBuffer(),
    await up.clone().gamma(2.2).normalize().png().toBuffer(),
  ];
}
