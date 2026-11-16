import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  analyzeSharedLabelGridStageReport,
  assessSharedLabelRowBandOcrRetry,
  caloriesRowCellsFromStitched,
  listSharedLabelGridStageIssues,
} from '../../../domain/sharedLabelGridStageReport.js';
import { parseMultiProductLabelTable } from '../../../domain/parseMultiProductLabelTable.js';
import { stitchSharedLabelGridTexts } from '../../../domain/stitchSharedLabelGridTexts.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const costcoSnapshotPath = path.join(
  repoRoot,
  'server/src/test/fixtures/costcoCandySharedLabelOcr.snapshot.json',
);

const LABEL = `Nutrition Facts
Amount per serving
Calories
Total Fat
Sodium
Protein
`;

test('stage report: clean synthetic passes all macro stages', () => {
  const values = ['140\n5g\n120mg\n2g', '150\n6g\n140mg\n8g', '160\n7g\n100mg\n6g'];
  const report = analyzeSharedLabelGridStageReport(LABEL, values, 'Snack A    Snack B    Snack C');
  assert.equal(report.macroImportBlocker, null);
  assert.equal(report.macroColumnCount, 3);
  assert.ok(report.stitchDiag.ok);
});

test('row-band retry: misaligned calories row with junk macro digits still retries body-column', () => {
  const stitched = `Nutrition Facts
Column 1  Column 2  Column 3
Calories
2 Packs (28g)  1 Bar (17g)  18g)
Total Fat
45g  35g  9g`;
  const parsed = parseMultiProductLabelTable(stitched);
  assert.ok(parsed);
  assert.ok((parsed?.filter((c) => c.nutrients.fat > 0).length ?? 0) >= 2, 'false-positive macro columns from junk');
  const assessment = assessSharedLabelRowBandOcrRetry(stitched, parsed);
  assert.equal(assessment.shouldRetryBodyColumn, true);
  assert.equal(assessment.reason, 'calories_row_cells_not_numeric');
});

test('row-band retry: plausible calories row keeps row-band path', () => {
  const stitched = `Nutrition Facts
Snack A  Snack B  Snack C
Calories
140  150  160
Total Fat
5g  6g  7g`;
  const parsed = parseMultiProductLabelTable(stitched);
  const assessment = assessSharedLabelRowBandOcrRetry(stitched, parsed);
  assert.equal(assessment.shouldRetryBodyColumn, false);
  assert.equal(assessment.reason, null);
});

test('stage report: missing row labels blocks at label_column_extraction', () => {
  const report = analyzeSharedLabelGridStageReport('garbage only', ['90', '110'], '');
  assert.equal(report.macroImportBlocker?.stage, 'label_column_extraction');
  assert.equal(report.macroImportBlocker?.reason, 'no_row_labels');
});

test('stage report: mis-indexed values block at parse_macros (stitch can still succeed)', () => {
  const stitched = stitchSharedLabelGridTexts(
    'Nutrition Facts\nCalories\nTotal Fat',
    [
      'SNICKERS\n% Daily Value*\n2 Packs (28g)\n90\n5g',
      'TWIX\n% Daily Value*\n1 Bar (17g)\n110\n6g',
    ],
    'Col A    Col B',
  );
  assert.ok(stitched);
  const cells = caloriesRowCellsFromStitched(stitched!);
  assert.ok(cells);
  assert.ok(
    cells!.some((c) => /pack|bar/i.test(c)),
    'calories row should expose serving-size OCR as the failure signal',
  );
  const report = analyzeSharedLabelGridStageReport(
    'Nutrition Facts\nCalories\nTotal Fat',
    [
      'SNICKERS\n% Daily Value*\n2 Packs (28g)\n90\n5g',
      'TWIX\n% Daily Value*\n1 Bar (17g)\n110\n6g',
    ],
    'Col A    Col B',
  );
  assert.equal(report.stitchDiag.ok, true);
  assert.equal(report.macroImportBlocker?.stage, 'parse_macros');
  assert.equal(report.macroImportBlocker?.reason, 'calories_row_cells_not_numeric');
});

test(
  'Costco candy OCR snapshot: row-band geometry yields numeric calories per column',
  { skip: !existsSync(costcoSnapshotPath) },
  async () => {
    const snap = JSON.parse(await readFile(costcoSnapshotPath, 'utf8')) as {
      labelColumnText: string;
      headerBandText: string;
      valueColumnTexts: string[];
      geometry: { lastOkStep: number; valueColumnCount: number };
    };

    assert.equal(snap.geometry.lastOkStep, 4, 'fixture assumes shared-rail geometry OK');
    assert.equal(snap.valueColumnTexts.length, snap.geometry.valueColumnCount);

    const report = analyzeSharedLabelGridStageReport(
      snap.labelColumnText,
      snap.valueColumnTexts,
      snap.headerBandText,
    );

    assert.ok(report.stitchDiag.ok);
    assert.equal(report.parsedColumnCount, 10, 'parse should emit one column per product strip');
    assert.equal(
      report.calorieColumnCount,
      snap.geometry.valueColumnCount,
      'parse still fills calories from mis-indexed % DV rows',
    );
    assert.equal(report.macroImportBlocker?.stage, 'parse_macros');
    assert.equal(report.macroImportBlocker?.reason, 'calories_row_cells_not_numeric');
    assert.ok(
      report.valueLineCounts.every((n) => n >= 3),
      'each value strip should carry multiple OCR lines',
    );
  },
);

test('stage report: label rail duplicated in valueColumnTexts[0] is skipped when opt-in', () => {
  const labelRailOnly = 'Nutrition Facts\nServing size\nAmount per serving\n% Daily Value*';
  const opts = { labelRailValueColumnIndex: 0 };
  const report = analyzeSharedLabelGridStageReport(
    'Nutrition Facts\nCalories\nProtein',
    [labelRailOnly, '90\n2g', '110\n6g'],
    '',
    opts,
  );
  assert.equal(report.valueLineCounts[0], 0);
  const issues = listSharedLabelGridStageIssues(
    'Nutrition Facts\nCalories\nProtein',
    [labelRailOnly, '90\n2g', '110\n6g'],
    '',
    opts,
  );
  assert.ok(
    !issues.some(
      (i) =>
        i.stage === 'value_column_extraction' &&
        i.reason === 'column_has_zero_value_lines' &&
        i.columnIndex === 0,
    ),
  );
});
