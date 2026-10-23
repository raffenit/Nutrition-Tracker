# Playbook — food import UI

## Symptom → where to look

| Symptom | File | Symbols |
| --- | --- | --- |
| Upload % / stuck processing | `web/src/pages/FoodPage.tsx` | `uploadFile`, `startProcessMessages`, `buildProcessProgress` |
| Progress bar / steps UI | `web/src/components/ImportProgress.tsx` | `ImportProgress`, `ImportProgressState` |
| Step messages (OCR phases) | `web/src/lib/importProcessingSteps.ts` | `IMAGE_IMPORT_STEPS`, `PDF_IMPORT_STEPS` |
| Drop zone, camera, URL | `web/src/components/FoodImportPanel.tsx` | `FoodImportPanel`, `acceptImportFile` |
| Multipart upload + progress events | `web/src/api/uploadWithProgress.ts` | `apiFormUpload` |
| Field highlight after import | `web/src/importFieldReview.ts` | review map types |
| Styles | `web/src/styles.css` | `.import-progress` |

## API

| Method | Path | Server handler |
| --- | --- | --- |
| POST | `/api/uploads` | `receiveUpload` in `foodRoutes.ts` |
| POST | `/api/import-url` | `importFromUrl` in `foodRoutes.ts` |

Processing is a **single blocking request** until JSON returns — UI steps are client-side estimates, not server SSE.

## Tests

- Web: `npm run check` in `web/` (typecheck only).
- Server import logic: see [label-ocr-and-parsing.md](./label-ocr-and-parsing.md).

## Maintenance

New user-visible import phases → update `importProcessingSteps.ts` and keep copy aligned with [label-ocr-and-parsing.md](./label-ocr-and-parsing.md). Update [CODE-MAP.md](../CODE-MAP.md) if you add components.
