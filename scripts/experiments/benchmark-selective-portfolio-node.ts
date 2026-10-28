import { resolve } from "node:path"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  arePipeline9RoutesOnSameNet,
  doPipeline9RoutesHaveCopperConflict,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver/GrowShrinkHighDensityIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

const mode = process.argv[2] ?? "selective"
if (mode !== "selective" && mode !== "fitness") {
  throw new Error("Usage: bun scripts/experiments/benchmark-selective-portfolio-node.ts [selective|fitness] [node.json]")
}
const nodePath = resolve(process.argv[3] ?? "tests/fixtures/srj18-sample002-large-node.json")
const node = await Bun.file(nodePath).json() as NodeWithPortPoints
const diagnostics: Record<string, number> = {}
const solver = new GrowShrinkHighDensityIntraNodeSolver({
  nodeWithPortPoints: node,
  viaDiameter: 0.3,
  traceWidth: 0.1,
  obstacleMargin: 0.15,
  obstacles: [],
  layerCount: 2,
  effort: 1,
  captureSearchDebug: false,
  selectivePortfolio: mode === "selective",
  enableNegotiatedSearch: true,
  priorityDagSearch: true,
  priorityDiagnostics: diagnostics,
  maxGrowthAttempts: 3,
  fallbackToInvalidGeometryOnFailure: false,
})
const cpuStarted = process.cpuUsage()
const startedAt = performance.now()
solver.solve()
const wallMs = performance.now() - startedAt
const cpu = process.cpuUsage(cpuStarted)
const connMap = new ConnectivityMap({})
const physicalChecks = [0, 0.15].map((clearance) => {
  let conflictingRoutePairs = 0
  for (let i = 0; i < solver.solvedRoutes.length; i++) {
    for (let j = i + 1; j < solver.solvedRoutes.length; j++) {
      const left = solver.solvedRoutes[i]!
      const right = solver.solvedRoutes[j]!
      if (arePipeline9RoutesOnSameNet(left, right, connMap)) continue
      if (doPipeline9RoutesHaveCopperConflict({ left, right, clearance, layerCount: 2 })) {
        conflictingRoutePairs++
      }
    }
  }
  return { clearance, conflictingRoutePairs }
})
console.log(JSON.stringify({
  mode,
  nodePath,
  wallMs,
  cpuMs: (cpu.user + cpu.system) / 1000,
  solved: solver.solved,
  failed: solver.failed,
  error: solver.error,
  scaleFactor: solver.scaleFactor,
  routeCount: solver.solvedRoutes.length,
  physicalCheckScope: "Pairwise intermediate-node copper checks only; root names from node, no external connectivity map, board obstacles or downstream repair. This script assumes a two-layer fixture.",
  physicalChecks,
  winningAttemptStats: solver.winningSolver?.stats,
  failedAttemptStats: solver.failedSolvers.map((attempt) => attempt.stats),
  diagnostics,
  routes: solver.solvedRoutes,
}, null, 2))
