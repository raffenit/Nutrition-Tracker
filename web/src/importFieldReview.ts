export type ImportFieldStatus = 'missing' | 'review';

export type ImportFieldReviewEntry = {
  status: ImportFieldStatus;
  reason: string;
};

export type ImportFieldReviewMap = Record<string, ImportFieldReviewEntry>;

export function importFieldsNeedingAttention(review: ImportFieldReviewMap | null | undefined): Array<
  [string, ImportFieldReviewEntry]
> {
  if (!review) return [];
  return Object.entries(review).filter(([, entry]) => entry.status === 'missing' || entry.status === 'review');
}

export function importReviewBannerText(review: ImportFieldReviewMap | null | undefined): string | null {
  const issues = importFieldsNeedingAttention(review);
  if (issues.length === 0) return null;
  const reviewCount = issues.filter(([, e]) => e.status === 'review').length;
  const missingCount = issues.filter(([, e]) => e.status === 'missing').length;
  const parts: string[] = [];
  if (reviewCount > 0) parts.push(`${reviewCount} to double-check`);
  if (missingCount > 0) parts.push(`${missingCount} not read`);
  return `Highlighted below — ${parts.join(', ')}.`;
}
