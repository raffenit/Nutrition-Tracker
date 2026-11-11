import { IMAGE_ANALYSIS_WIDTH } from './imageAnalysisGeometry.js';

/**
 * Label-band pixels usually form two masses (paper + ink). Sparse near-white peaks are glare.
 */
export type BandLuminancePolarity = 'dark_on_light' | 'light_on_dark';

export type BandLuminanceRoles = {
  /** Dominant paper/panel color (larger histogram mass). */
  background: number;
  /** Text / rule ink color (smaller histogram mass). */
  ink: number;
  polarity: BandLuminancePolarity;
  glareCap: number;
  clusterCount: number;
  /** For diagnostics. */
  clusters: Array<{ centroid: number; massFraction: number; role: 'background' | 'ink' | 'glare' | 'other' }>;
};

export type BandLuminanceClusterParams = {
  /** Minimum mass for the dominant (paper) peak. */
  luminanceClusterMinMassFraction: number;
  /** Minimum mass for the secondary (ink) peak — labels are always two colors. */
  luminanceInkMinMassFraction: number;
  /** Ink and background centroids must differ by at least this many luminance steps. */
  luminanceMinSeparation: number;
  luminanceGlareMinLevel: number;
  luminanceGlareMaxMassFraction: number;
};

const W = IMAGE_ANALYSIS_WIDTH;

export const DEFAULT_BAND_LUMINANCE_CLUSTER_PARAMS: BandLuminanceClusterParams = {
  luminanceClusterMinMassFraction: 12 / W,
  luminanceInkMinMassFraction: 3 / W,
  luminanceMinSeparation: 18,
  luminanceGlareMinLevel: 238,
  luminanceGlareMaxMassFraction: 18 / W,
};
