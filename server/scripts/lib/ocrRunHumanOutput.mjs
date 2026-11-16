/**
 * Human-readable headings for local OCR scripts (no dependency on dist).
 */

export function printImageRunHeader(name, { fixture, hint, pipeline }) {
  const bar = '='.repeat(70);
  console.log(`\n${bar}`);
  console.log(`Photo: ${name}`);
  console.log(bar);

  if (fixture) {
    const cols =
      fixture.valueColumnCount != null ? `, about ${fixture.valueColumnCount} products` : '';
    console.log(`What we expect: ${describeLayout(fixture.layout)}${cols}`);
  }

  const size = `${hint.width} x ${hint.height}`;
  console.log(`Image size: ${size}${hint.widePanel ? ' (wide variety-style panel)' : ''}`);

  const step3 = pipeline.steps[3]?.data?.layout;
  const colCount = pipeline.plan?.valueColumns?.length;
  if (pipeline.lastOkStep >= 4 && pipeline.plan) {
    console.log(
      `Geometry: ready — ${colCount} product columns, layout ${step3 ?? 'shared_rail'}`,
    );
  } else {
    console.log(`Geometry: stopped at pipeline step ${pipeline.lastOkStep} (layout ${step3 ?? 'unknown'})`);
  }
  console.log('');
}

function describeLayout(layout) {
  switch (layout) {
    case 'shared_rail':
      return 'shared label on the left, one column of values per product';
    case 'per_column_labels':
      return 'each product column has its own mini label';
    case 'split_single':
      return 'one product, two side-by-side halves';
    case 'single':
      return 'single nutrition panel';
    default:
      return layout ?? 'unknown';
  }
}

export function printImageRunSummary({
  elapsedSec,
  textLength,
  parsedColCount,
  parsedPanels,
  placeholders,
  expectedCols,
  draftCalories,
  warning,
  stitchMetrics,
  manifestOutcome,
}) {
  console.log('');
  console.log('--- Results ---');
  console.log(`Time: ${elapsedSec}s`);
  console.log(`Recognized text: ${textLength} characters`);

  if (stitchMetrics) {
    const macro = stitchMetrics.macroColumns ?? 0;
    const rows = stitchMetrics.rowLabels ?? 0;
    console.log(
      `Variety table: ${stitchMetrics.parsedColumns ?? '?'} columns stitched, ${macro} with macros, ${rows} nutrient row labels`,
    );
  }

  console.log(
    `Import panels: ${parsedPanels + placeholders} total (${parsedPanels} with data, ${placeholders} need manual entry)`,
  );
  if (expectedCols != null) console.log(`Expected products from geometry: ${expectedCols}`);
  console.log(`Parsed table columns: ${parsedColCount}`);
  if (draftCalories != null && draftCalories !== '') {
    console.log(`Draft calories (first panel with data): ${draftCalories}`);
  }
  if (warning) console.log(`Note: ${warning}`);
  if (manifestOutcome) console.log(manifestOutcome);
  console.log('');
}
