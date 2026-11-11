import {
  DEFAULT_BAND_LUMINANCE_CLUSTER_PARAMS,
  type BandLuminanceClusterParams,
  type BandLuminancePolarity,
  type BandLuminanceRoles,
} from '../domain/bandLuminanceRoles.js';
import { DEFAULT_RULED_TABLE_GRID_PARAMS } from '../domain/ruledTableGridParams.js';

export type InkProfileGutterSense = 'local_minimum' | 'local_maximum';

/** Vertical scan band shared by ruled-grid and ink-projection column detect. */
export function scanBandLuminanceY(
  height: number,
  params: { valueRowScanTopSkipFraction: number; valueRowScanBottomSkipFraction: number } = DEFAULT_RULED_TABLE_GRID_PARAMS,
): { y0: number; y1: number } {
  const y0 = Math.round(height * params.valueRowScanTopSkipFraction);
  const y1 = Math.max(y0 + 1, height - Math.round(height * params.valueRowScanBottomSkipFraction));
  return { y0, y1 };
}

/** Two-color roles for any wide-band / table image region (both label polarities). */
export function classifyBandLuminanceInScanBand(
  pixels: Uint8Array,
  width: number,
  height: number,
  x0: number,
  x1: number,
): BandLuminanceRoles {
  const { y0, y1 } = scanBandLuminanceY(height);
  return classifyBandLuminance(pixels, width, height, x0, x1, y0, y1);
}

/** Brightness-level test for vertical gutters (ruled grid + ink projection). */
export function gutterBrightnessLevel(
  roles: BandLuminanceRoles,
  gutterBrightnessMinFraction: number,
): number {
  if (roles.polarity === 'light_on_dark') {
    const span = roles.ink - roles.background;
    return roles.background + span * (1 - gutterBrightnessMinFraction);
  }
  const mid = (roles.background + roles.ink) / 2;
  return Math.max(mid, roles.background * gutterBrightnessMinFraction);
}

/**
 * Ruled vertical gutters between value columns are bright paper. When dark cell bodies
 * dominate the histogram, polarity becomes light_on_dark and {@link gutterBrightnessLevel}
 * would treat dark interiors as gutters — use this threshold instead (bright-gap test).
 */
export function verticalRuledGutterBrightnessLevel(
  roles: BandLuminanceRoles,
  gutterBrightnessMinFraction: number,
): number {
  if (roles.polarity === 'light_on_dark') {
    const span = roles.ink - roles.background;
    return roles.ink - span * (1 - gutterBrightnessMinFraction);
  }
  return gutterBrightnessLevel(roles, gutterBrightnessMinFraction);
}

/** Ink column projection threshold derived from classified paper + ink. */
export function inkProfileGutterThreshold(
  roles: BandLuminanceRoles,
  gutterBrightnessMinFraction: number = DEFAULT_RULED_TABLE_GRID_PARAMS.gutterBrightnessMinFraction,
): { level: number; sense: InkProfileGutterSense } {
  const brightnessLevel = gutterBrightnessLevel(roles, gutterBrightnessMinFraction);
  const level = 255 - brightnessLevel;
  if (roles.polarity === 'dark_on_light') {
    return { level, sense: 'local_minimum' };
  }
  return { level, sense: 'local_maximum' };
}

function buildHistogram(
  pixels: Uint8Array,
  width: number,
  height: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): Float64Array {
  const hist = new Float64Array(256);
  for (let x = x0; x < x1; x += 1) {
    for (let y = y0; y < y1; y += 1) {
      hist[pixels[y * width + x]!]! += 1;
    }
  }
  return hist;
}

/** Local maxima on the raw band histogram (no smoothing — smoothing merges paper + ink). */
function findRawHistogramPeaks(hist: Float64Array, minMass: number): Array<{ level: number; mass: number }> {
  const peaks: Array<{ level: number; mass: number }> = [];
  for (let i = 0; i < 256; i += 1) {
    const v = hist[i]!;
    if (v <= 0) continue;
    const left = i > 0 ? hist[i - 1]! : 0;
    const right = i < 255 ? hist[i + 1]! : 0;
    if (v < left || v < right) continue;
    if (v < minMass) continue;
    peaks.push({ level: i, mass: v });
  }
  return peaks;
}

function isGlarePeak(
  peak: { level: number; mass: number },
  inkLevel: number,
  backgroundLevel: number,
  total: number,
  p: BandLuminanceClusterParams,
): boolean {
  const glareMaxMass = total * p.luminanceGlareMaxMassFraction;
  if (peak.mass > glareMaxMass) return false;
  const hiBackground = Math.max(inkLevel, backgroundLevel);
  const loBackground = Math.min(inkLevel, backgroundLevel);
  if (peak.level >= p.luminanceGlareMinLevel && peak.level > hiBackground + 15) return true;
  if (peak.level <= loBackground - 40 && peak.mass <= glareMaxMass) return true;
  return false;
}

function pickInkPeak(
  peaks: Array<{ level: number; mass: number }>,
  backgroundLevel: number,
  minSeparation: number,
): { level: number; mass: number } | undefined {
  let best: { level: number; mass: number } | undefined;
  for (const peak of peaks) {
    if (Math.abs(peak.level - backgroundLevel) < minSeparation) continue;
    if (!best || peak.mass > best.mass) best = peak;
  }
  return best;
}

function weightedPercentile(hist: Float64Array, fraction: number): number {
  const total = hist.reduce((s, v) => s + v, 0);
  if (total <= 0) return 0;
  let acc = 0;
  for (let i = 0; i < 256; i += 1) {
    acc += hist[i]!;
    if (acc / total >= fraction) return i;
  }
  return 255;
}

/**
 * Nutrition labels: one background + one ink color (either polarity). Extra sparse peaks = glare.
 */
export function classifyBandLuminance(
  pixels: Uint8Array,
  width: number,
  height: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  params: Partial<BandLuminanceClusterParams> = {},
): BandLuminanceRoles {
  const p = { ...DEFAULT_BAND_LUMINANCE_CLUSTER_PARAMS, ...params };
  const hist = buildHistogram(pixels, width, height, x0, x1, y0, y1);
  const total = hist.reduce((sum, v) => sum + v, 0);
  if (total <= 0) {
    return {
      background: 255,
      ink: 0,
      polarity: 'dark_on_light',
      glareCap: 255,
      clusterCount: 0,
      clusters: [],
    };
  }

  const minInkMass = total * p.luminanceInkMinMassFraction;
  const minBackgroundMass = total * p.luminanceClusterMinMassFraction;
  const rawPeaks = findRawHistogramPeaks(hist, minInkMass).sort((a, b) => b.mass - a.mass);

  const clusters: BandLuminanceRoles['clusters'] = [];
  let glareCap = 255;

  if (rawPeaks.length === 0) {
    const ink = weightedPercentile(hist, 0.25);
    const background = weightedPercentile(hist, 0.72);
    const polarity = background >= ink ? 'dark_on_light' : 'light_on_dark';
    glareCap = polarity === 'dark_on_light' ? Math.min(255, background + 25) : 255;
    return {
      background,
      ink,
      polarity,
      glareCap,
      clusterCount: 2,
      clusters: [
        { centroid: ink, massFraction: 0, role: 'ink' },
        { centroid: background, massFraction: 0, role: 'background' },
      ],
    };
  }

  const backgroundCandidate =
    rawPeaks.find((peak) => peak.mass >= minBackgroundMass) ?? rawPeaks[0]!;
  const inkGuess =
    pickInkPeak(
      rawPeaks.filter((peak) => peak !== backgroundCandidate),
      backgroundCandidate.level,
      p.luminanceMinSeparation,
    ) ?? rawPeaks.find((peak) => peak !== backgroundCandidate && peak.mass >= minInkMass);

  const inkLevelForGlare = inkGuess?.level ?? backgroundCandidate.level;
  const backgroundLevelForGlare = backgroundCandidate.level;

  for (const peak of rawPeaks) {
    if (isGlarePeak(peak, inkLevelForGlare, backgroundLevelForGlare, total, p)) {
      clusters.push({ centroid: peak.level, massFraction: peak.mass / total, role: 'glare' });
      if (peak.level >= p.luminanceGlareMinLevel) {
        glareCap = Math.min(glareCap, peak.level - 1);
      }
    }
  }

  const nonGlare = rawPeaks.filter(
    (peak) => !isGlarePeak(peak, inkLevelForGlare, backgroundLevelForGlare, total, p),
  );

  let backgroundPeak = nonGlare.find((peak) => peak.mass >= minBackgroundMass) ?? nonGlare[0] ?? backgroundCandidate;
  let inkPeak =
    pickInkPeak(
      nonGlare.filter((peak) => peak !== backgroundPeak),
      backgroundPeak.level,
      p.luminanceMinSeparation,
    ) ?? inkGuess;

  if (!inkPeak || Math.abs(inkPeak.level - backgroundPeak.level) < p.luminanceMinSeparation) {
    const ink = weightedPercentile(hist, 0.22);
    const background = weightedPercentile(hist, 0.74);
    const polarity: BandLuminancePolarity = background >= ink ? 'dark_on_light' : 'light_on_dark';
    clusters.push(
      { centroid: ink, massFraction: 0, role: 'ink' },
      { centroid: background, massFraction: 0, role: 'background' },
    );
    if (polarity === 'dark_on_light') {
      glareCap = Math.min(glareCap, Math.min(255, background + 30));
    }
    return {
      background,
      ink,
      polarity,
      glareCap,
      clusterCount: clusters.length,
      clusters,
    };
  }

  if (backgroundPeak.mass < inkPeak.mass) {
    const swap = backgroundPeak;
    backgroundPeak = inkPeak;
    inkPeak = swap;
  }

  const background = backgroundPeak.level;
  const ink = inkPeak.level;
  const polarity: BandLuminancePolarity = background >= ink ? 'dark_on_light' : 'light_on_dark';

  clusters.push(
    { centroid: ink, massFraction: inkPeak.mass / total, role: 'ink' },
    { centroid: background, massFraction: backgroundPeak.mass / total, role: 'background' },
  );

  if (polarity === 'dark_on_light') {
    glareCap = Math.min(glareCap, Math.min(255, background + 30));
  }

  return {
    background,
    ink,
    polarity,
    glareCap,
    clusterCount: clusters.length,
    clusters,
  };
}
