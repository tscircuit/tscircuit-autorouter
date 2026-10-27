import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { PriorityDagIntraNodeSolver } from "../../lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import type { NodeWithPortPoints } from "../../lib/types/high-density-types"
import { doPipeline9RoutesHaveCopperConflict } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"

// Replay captured geometry at physical size. No local timing claims are made.
// Direct family execution isolates the mechanism from competing portfolio wins.
const fixtures = process.argv.slice(2)
if (!fixtures.length) fixtures.push("a13-srj18-hard-node", "srj18-sample002-large-node")
const results: Record<string, unknown>[] = []
for (const fixture of fixtures) {
  const input = readFileSync(new URL(`../../tests/fixtures/${fixture}.json`, import.meta.url), "utf8")
  const node = JSON.parse(input) as NodeWithPortPoints
  const nets: Record<string, string[]> = {}
  for (const point of node.portPoints) {
    if (!point.rootConnectionName) throw new Error("Captured node has no electrical owner")
    const names = nets[point.rootConnectionName] ??= []
    if (!names.includes(point.connectionName)) names.push(point.connectionName)
  }
  for (const enabled of [false, true]) {
    const solver = new PriorityDagIntraNodeSolver({
      nodeWithPortPoints: structuredClone(node), copperCandidateSearch: enabled,
      connMap: new ConnectivityMap(nets), priorityFamilySize: 6,
      viaDiameter: 0.3, viaHoleDiameter: 0.15,
      minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
      traceWidth: 0.1, obstacleMargin: 0.15, layerCount: 2, captureSearchDebug: false,
      hyperParameters: {
        CELL_SIZE_FACTOR: 1, SHUFFLE_SEED: 0,
        FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR: 2,
        FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR: 1,
        FUTURE_CONNECTION_PROXIMITY_VD: 10,
        MISALIGNED_DIST_PENALTY_FACTOR: 5,
      },
    })
    solver.solve()
    let copperConflicts = 0
    for (let left = 0; left < solver.solvedRoutes.length; left++) {
      for (let right = left + 1; right < solver.solvedRoutes.length; right++) {
        const a = solver.solvedRoutes[left], b = solver.solvedRoutes[right]
        if (a.rootConnectionName === b.rootConnectionName) continue
        if (doPipeline9RoutesHaveCopperConflict({ left: a, right: b, clearance: 0.15, layerCount: 2 })) copperConflicts++
      }
    }
    const result = {
      fixture, enabled, inputSha256: createHash("sha256").update(input).digest("hex"),
      sourceRules: { traceWidth: 0.1, viaDiameter: 0.3, viaHoleDiameter: 0.15, obstacleMargin: 0.15, minHoleGap: 0.1, layerCount: 2 },
      solved: solver.solved, failed: solver.failed, error: solver.error,
      iterations: solver.iterations, maxIterations: solver.MAX_ITERATIONS,
      routeCount: solver.solvedRoutes.length, copperConflicts,
      diagnostics: solver.priorityDiagnostics,
    }
    results.push(result)
    console.log(JSON.stringify(result))
  }
}
mkdirSync(new URL("./results", import.meta.url), { recursive: true })
writeFileSync(new URL("./results/captured-node-replay.json", import.meta.url), JSON.stringify({ results }, null, 2) + "\n")
