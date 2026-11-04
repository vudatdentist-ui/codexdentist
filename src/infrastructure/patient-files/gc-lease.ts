import type { PrismaClient } from "@prisma/client";

/** Keep every queued object leased and consume all asynchronous renewal failures. */
export function startObjectGcLease(
  db: PrismaClient,
  table: "PatientFileObjectStage" | "PatientFilePurgeManifest",
  ids: string[],
  token: string,
  leaseMs: number,
) {
  const deadline = table === "PatientFileObjectStage" ? "gcAfter" : "availableAt";
  const state = table === "PatientFileObjectStage" ? "GC_PENDING" : "PROCESSING";
  const active = new Set(ids);
  const lost = new Set<string>();
  let pending: Promise<void> | null = null;
  const refresh = (): Promise<void> => {
    if (pending) return pending;
    const remaining = [...active].filter((id) => !lost.has(id));
    if (!remaining.length) return Promise.resolve();
    pending = (async () => {
      try {
        const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(
          `UPDATE "${table}"
           SET "${deadline}" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + ($3 * INTERVAL '1 millisecond'),
               "updatedAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
           WHERE "id" = ANY($1::text[]) AND "lastErrorCode" = $2
             AND "state" = '${state}' AND "${deadline}" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
           RETURNING "id"`,
          remaining, token, leaseMs,
        );
        const owned = new Set(rows.map((row) => row.id));
        for (const id of remaining) if (!owned.has(id)) lost.add(id);
      } catch {
        for (const id of remaining) lost.add(id);
      } finally {
        pending = null;
      }
    })();
    return pending;
  };
  const timer = setInterval(() => { void refresh(); }, Math.max(10, Math.floor(leaseMs / 3)));
  timer.unref();
  return {
    async owns(id: string) { await refresh(); return !lost.has(id); },
    release(id: string) { active.delete(id); },
    async stop() { clearInterval(timer); if (pending) await pending; },
  };
}
