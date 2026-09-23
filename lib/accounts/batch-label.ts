/**
 * Batch (cohort) label rules, shared by server and client. Client-safe: no
 * node imports, so the Accounts settings form can use the same limit.
 */

/** Longest batch label accepted -- a label, not a paragraph. */
export const BATCH_LABEL_MAX_LENGTH = 80;

/**
 * Normalize a submitted batch label: trim and collapse inner whitespace so
 * "Sept  2026 A " and "Sept 2026 A" land in the same group. Empty becomes
 * null (ungrouped). Case is deliberately preserved -- it is free text.
 */
export function normalizeBatchLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const collapsed = value.trim().replace(/\s+/g, ' ');
  if (!collapsed) return null;
  return collapsed.slice(0, BATCH_LABEL_MAX_LENGTH);
}
