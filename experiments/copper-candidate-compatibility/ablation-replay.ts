import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { PriorityDagIntraNodeSolver } from "../../lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import type { NodeWithPortPoints } from "../../lib/types/high-density-types"
import { doPipeline9RoutesHaveCopperConflict } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"

const arms = [
  { name: "control", copperCandidateSearch: false, copperUnpriceFutureCosts: false },
  { name: "soft-only", copperCandidateSearch: false, copperUnpriceFutureCosts: true },
  { name: "archive-only", copperCandidateSearch: true, copperUnpriceFutureCosts: false },
  { name: "full", copperCandidateSearch: true, copperUnpriceFutureCosts: true },
]
const fixtures = process.argv.slice(2)
if (fixtures.length === 0) fixtures.push("a13-srj18-hard-node", "srj18-sample002-large-node")
const results: Record<string, unknown>[] = []
for (const fixture of fixtures) {
  const raw = readFileSync(new URL(`../../tests/fixtures/${fixture}.json`, import.meta.url), "utf8")
  const node = JSON.parse(raw) as NodeWithPortPoints
  const nets: Record<string, string[]> = {}
  for (const point of node.portPoints) {
    if (!point.rootConnectionName) throw new Error("Captured node has no electrical owner")
    const members = nets[point.rootConnectionName] ??= []
    if (!members.includes(point.connectionName)) members.push(point.connectionName)
  }
  for (const arm of arms) {
    const solver = new PriorityDagIntraNodeSolver({
      nodeWithPortPoints: structuredClone(node),
      copperCandidateSearch: arm.copperCandidateSearch,
      copperUnpriceFutureCosts: arm.copperUnpriceFutureCosts,
      connMap: new ConnectivityMap(nets), priorityFamilySize: 6,
      viaDiameter: 0.3, viaHoleDiameter: 0.15,
      minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
      traceWidth: 0.1, obstacleMargin: 0.15, layerCount: 2, captureSearchDebug: false,
      hyperParameters: { CELL_SIZE_FACTOR: 1, SHUFFLE_SEED: 0, FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR: 2, FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR: 1, FUTURE_CONNECTION_PROXIMITY_VD: 10, MISALIGNED_DIST_PENALTY_FACTOR: 5 },
    })
    solver.solve()
    let copperConflicts = 0
    let drillConflicts = 0
    for (let left = 0; left < solver.solvedRoutes.length; left++) {
      for (let right = left + 1; right < solver.solvedRoutes.length; right++) {
        const a = solver.solvedRoutes[left], b = solver.solvedRoutes[right]
        for (const va of a.vias) for (const vb of b.vias) {
          const distance = Math.hypot(va.x - vb.x, va.y - vb.y)
          if (!(distance === 0 && a.rootConnectionName === b.rootConnectionName) && distance < 0.25) drillConflicts++
        }
        if (a.rootConnectionName !== b.rootConnectionName && doPipeline9RoutesHaveCopperConflict({ left: a, right: b, clearance: 0.15, layerCount: 2 })) copperConflicts++
      }
    }
    const result = {
      fixture, arm: arm.name, inputSha256: createHash("sha256").update(raw).digest("hex"),
      effectiveOptions: { copperCandidateSearch: solver.copperCandidateSearch, copperUnpriceFutureCosts: solver.copperUnpriceFutureCosts },
      solved: solver.solved, failed: solver.failed, error: solver.error,
      chargedPolicyIterations: solver.iterations, maxPolicyIterations: solver.MAX_ITERATIONS,
      routeCount: solver.solvedRoutes.length, copperConflicts, drillConflicts,
      routeHash: createHash("sha256").update(JSON.stringify(solver.solvedRoutes)).digest("hex"),
      diagnostics: solver.priorityDiagnostics,
    }
    results.push(result)
    console.log(JSON.stringify(result))
  }
}
const directory = resolve(process.env.COPPER_ABLATION_OUTPUT ?? "experiments/copper-candidate-compatibility/ablation/local-results")
mkdirSync(directory, { recursive: true })
writeFileSync(`${directory}/captured-node-four-way.json`, JSON.stringify({ note: "Functional mechanism/work replay only. Direct complete charged policy clock, not CPU instructions or corpus timing. Restricted UNKNOWN supplies no output quality claim.", results }, null, 2) + "\n")
