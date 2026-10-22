import type { Program } from "./model";
export const TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/** Legacy trash used updatedAt as its deletion timestamp. */
export function trashDeadline(
  program: Pick<Program, "status" | "deletedAt" | "updatedAt">,
): number | undefined {
  if (program.status !== "deleted") return undefined;
  const deleted = Date.parse(program.deletedAt || program.updatedAt);
  return Number.isFinite(deleted) ? deleted + TRASH_RETENTION_MS : undefined;
}
