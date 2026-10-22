import type { DurableObjectStorage } from "@cloudflare/workers-types";
import type { Program } from "../../src/domain/model";
import { trashDeadline } from "../../src/domain/trash";

/** One SQLite transaction removes expired programs and their private artifacts. */
export function purgeExpiredPrograms(
  storage: Pick<DurableObjectStorage, "sql" | "transactionSync">,
  now: number,
): number {
  return storage.transactionSync(() => {
    const sql = storage.sql;
    const programs = sql
      .exec("SELECT payload FROM records WHERE kind='programs'")
      .toArray();
    let purged = 0;
    for (const row of programs) {
      const p = JSON.parse(String(row.payload)) as Program;
      if (p.status !== "deleted") continue;
      if (!p.deletedAt || !Number.isFinite(Date.parse(p.deletedAt))) {
        p.deletedAt = Number.isFinite(Date.parse(p.updatedAt))
          ? p.updatedAt
          : new Date(now).toISOString();
        sql.exec(
          "UPDATE records SET payload=? WHERE kind='programs' AND id=?",
          JSON.stringify(p),
          p.id,
        );
      }
      const deadline = trashDeadline(p);
      if (deadline === undefined || deadline > now) continue;
      // Every stored/canceled/reused signature and export remains referenced until purge.
      // Retain any file also referenced by another program as a defensive scope guard.
      sql.exec(
        `DELETE FROM files WHERE id IN (
        SELECT json_extract(payload,'$.fileId') FROM records
        WHERE program_id=? AND kind IN ('signatures','exports')
      ) AND id NOT IN (
        SELECT json_extract(payload,'$.fileId') FROM records
        WHERE program_id<>? AND kind IN ('signatures','exports') AND json_extract(payload,'$.fileId') IS NOT NULL
      )`,
        p.id,
        p.id,
      );
      sql.exec(
        "DELETE FROM sessions WHERE json_extract(payload,'$.programId')=?",
        p.id,
      );
      sql.exec(
        "DELETE FROM attempts WHERE instr(key, ?) > 0",
        `:student:${p.id}:`,
      );
      sql.exec(
        "DELETE FROM records WHERE program_id=? OR (kind='programs' AND id=?)",
        p.id,
        p.id,
      );
      purged++;
    }
    return purged;
  });
}
