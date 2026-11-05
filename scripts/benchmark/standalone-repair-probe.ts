import { writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { loadSrj18Sample, getConnectivityMapFromSimpleRouteJson } from "../benchmarks/srj18Fixtures"
import { GlobalDrcForceImproveSolver } from "../lib"
import { TraceContactGuard } from "../lib/solvers/GlobalDrcForceImproveSolver/TraceContactGuard"
import { getDrcSnapshot } from "../lib/solvers/GlobalDrcForceImproveSolver/drc-snapshot"
const calls: Record<string, {calls: number; ms: number}> = {}
if (process.env.COUNTERS === "1") {
  for (const [label, prototype, names] of [
    ["solver", GlobalDrcForceImproveSolver.prototype, ["getSnapshot", "repairPeerContacts", "rememberOverlapSafeRoutes", "acceptSolvedRoutes"]],
    ["guard", TraceContactGuard.prototype, ["collectContacts", "hasContactPair", "prepareCandidateCheck"]],
  ] as const) {
    for (const name of names) {
      const p = prototype as any
      const original = p[name]
      if (typeof original !== "function") continue
      p[name] = function (...args: unknown[]): unknown {
        const started = performance.now()
        const value = original.apply(this, args)
        const row = calls[`${label}.${name}`] ??= {calls: 0, ms: 0}
        row.calls++; row.ms += performance.now() - started
        if (name !== "prepareCandidateCheck") return value
        return (...candidateArgs: unknown[]): unknown => {
          const start = performance.now()
          const result = value(...candidateArgs)
          const item = calls["guard.candidateCheck"] ??= {calls: 0, ms: 0}
          item.calls++; item.ms += performance.now() - start
          return result
        }
      }
    }
  }
}
const sample = loadSrj18Sample(Number(process.argv[2]) - 1)
const { srj, hdRoutes, ...options } = sample.params
const started = performance.now()
const initial = getDrcSnapshot(srj, hdRoutes)
const solver = new GlobalDrcForceImproveSolver({ ...options, srj, hdRoutes, connMap: getConnectivityMapFromSimpleRouteJson(srj), effort: 1, maxIterations: 16 })
solver.solve()
const output = solver.getOutput()
const final = getDrcSnapshot(srj, output)
writeFileSync(process.argv[3]!, JSON.stringify({sample: sample.sampleId, elapsedMs: performance.now() - started, peakMiB: process.resourceUsage().maxRSS / 1024, initial: initial.count, final: final.count, stats: solver.stats, iterations: solver.iterations, calls, outputHash: createHash("sha256").update(JSON.stringify(output)).digest("hex")}, null, 2))
