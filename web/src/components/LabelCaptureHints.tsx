/** Tips for nutrition-label photos — shown before capture/upload (not product-specific). */
export function LabelCaptureHints() {
  return (
    <details className="label-photo-tips">
      <summary>Tips for a clear label photo</summary>
      <ul>
        <li>
          <strong>Tap to focus</strong> on the Nutrition Facts panel before you shoot (avoid focusing on the background).
        </li>
        <li>
          Hold the phone <strong>flat to the label</strong>, not at a steep angle — reduces blur and skew.
        </li>
        <li>
          Fill the frame with the label; <strong>step back slightly</strong> if close-ups look soft (shallow depth of field).
        </li>
        <li>
          Use bright, even light; avoid glare on glossy bottles and curved wraps.
        </li>
        <li>
          On bottles, keep the <strong>center of the label</strong> in focus — edges curve away and blur more easily.
        </li>
      </ul>
      <p className="muted label-photo-tips-note">
        Using your phone&apos;s built-in camera (below) usually gives better focus and HDR than an in-browser camera.
      </p>
    </details>
  );
}

/** Short nudge when OCR only partially filled macros. */
export function partialLabelImportHint(nutrients: {
  calories: number;
  fat: number;
  carbs: number;
  protein: number;
}): string | null {
  const core = [nutrients.calories, nutrients.fat, nutrients.carbs, nutrients.protein];
  const filled = core.filter((value) => value > 0).length;
  if (filled >= 4) return null;
  return 'Some values may be missing — check the fields below or retake the photo using the tips above (focus, lighting, fill the frame).';
}
