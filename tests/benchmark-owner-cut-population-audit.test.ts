import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { auditOwnerCutPasses } from "../scripts/benchmark/runOwnerCutOperatorBenchmark"

test("operator audit keeps all19rows, refuses censored speedups and rejects wrong provenance or duplicate queries", (): void => {
  const reference = JSON.parse(readFileSync(new URL("../scripts/benchmark/owner-cut-real-query-reference.json", import.meta.url), "utf8"))
  const rows = reference.samples.flatMap((sample: any) => sample.queries.map((query: any) => ({
    sample: sample.sample, queryIndex: query.index, routeId: query.routeId,
    fingerprint: `context-${sample.sample}-${query.index}`, nativeResultHash: `native-${sample.sample}-${query.index}`,
    status: "complete", comparison: { classification: "exact" }, elapsedMs: 10,
  })))
  const passes = ["native", "candidate", "candidate", "native"].map((arm, index) => ({
    schema: 1, arm, status: "complete", provenance: { sha: "pinned" }, runtime: { processId: index, memoryLimitBytes: 16000000000 },
    candidateWorkCap: 300000000, rows: structuredClone(rows), continuations: [{ sample: 6 }, { sample: 14 }],
  }))
  expect(auditOwnerCutPasses(passes as any).all19ExactAcrossPasses).toBe(true)
  expect(auditOwnerCutPasses(passes as any).fullPopulationCandidateOverNative).toBe(1)
  const unknown = structuredClone(passes)
  unknown[1]!.rows[10]!.comparison.classification = "unknown"
  unknown[1]!.rows[10]!.elapsedMs = 0.01
  const censored = auditOwnerCutPasses(unknown as any)
  expect(censored.all19ExactAcrossPasses).toBe(false)
  expect(censored.fullPopulationCandidateOverNative).toBeNull()
  expect((censored.totals as any[])[1].classifications.length).toBe(19)
  for (const mutation of ["missing", "duplicate", "context", "source", "runtime", "continuation", "duration"] as const) {
    const invalid = structuredClone(passes)
    if (mutation === "missing") invalid[1]!.rows.pop()
    if (mutation === "duplicate") for (const pass of invalid) pass.rows[1] = pass.rows[0]!
    if (mutation === "context") invalid[1]!.rows[0]!.fingerprint = "other"
    if (mutation === "source") invalid[1]!.provenance.sha = "other"
    if (mutation === "runtime") invalid[1]!.runtime.memoryLimitBytes++
    if (mutation === "continuation") invalid[1]!.continuations[1]!.sample = 99
    if (mutation === "duration") invalid[1]!.rows[0]!.elapsedMs = Number.NaN
    expect(() => auditOwnerCutPasses(invalid as any)).toThrow()
  }
  const zero = structuredClone(passes)
  for (const pass of zero) for (const row of pass.rows) row.elapsedMs = 0
  expect(auditOwnerCutPasses(zero as any).fullPopulationCandidateOverNative).toBeNull()
})
