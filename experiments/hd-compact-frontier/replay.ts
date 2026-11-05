import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9RegularNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { HighDensitySolverA01Compact } from "lib/solvers/HyperHighDensitySolver/HighDensitySolverA01Compact"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

// The input is a serialized Pipeline9 highDensityRouteSolver entrance. Use a
// fresh process per variant; report timing separately from the parity hash.
const [input, nodeId, rawScale, variant] = process.argv.slice(2)
if (!input || !nodeId || !rawScale || !["baseline", "storage", "pruned"].includes(variant!)) {
  throw new Error("Usage: bun experiments/hd-compact-frontier/replay.ts INPUT NODE SCALE baseline|storage|pruned")
}
const packed = await Bun.file(input).json()
const inputNode = (packed.nodePortPoints as NodeWithPortPoints[]).find((node) => node.capacityMeshNodeId === nodeId)
if (!inputNode) throw new Error(`No captured node ${nodeId}`)
const regular = createPipeline9RegularNodeSolver({
  ...packed,
  connMap: new ConnectivityMap(packed.connMap.netMap),
  nodePfById: new Map(packed.nodePfById),
  nodeWithPortPoints: inputNode,
})
const original = regular.unsolvedNodePortPoints[0]!
const scale = Number(rawScale)
if (!Number.isFinite(scale) || scale <= 0) throw new Error(`Invalid scale ${rawScale}`)
const node = {
  ...original, width: original.width * scale, height: original.height * scale,
  portPoints: original.portPoints.map((point) => ({
    ...point,
    x: original.center.x + (point.x - original.center.x) * scale,
    y: original.center.y + (point.y - original.center.y) * scale,
  })),
}
const props = {
  nodeWithPortPoints: node, cellSizeMm: 0.1, viaDiameter: packed.viaDiameter,
  viaMinDistFromBorder: packed.viaDiameter / 2, traceMargin: 0.1,
  traceThickness: packed.traceWidth, effort: packed.effort,
  hyperParameters: { shuffleSeed: 0 },
}
const started = performance.now()
const solver = variant === "baseline"
  ? new HighDensitySolverA01(props)
  : new HighDensitySolverA01Compact({ ...props, compactFrontierPruning: variant === "pruned" })
solver.solve()
const elapsedMs = performance.now() - started
const routes = solver.getOutput()
console.log(JSON.stringify({
  nodeId, scale, variant, elapsedMs, solved: solver.solved, failed: solver.failed,
  error: solver.error, iterations: solver.iterations, maxIterations: solver.MAX_ITERATIONS,
  routeCount: routes.length, routeHash: Bun.hash(JSON.stringify(routes)).toString(),
  peakRssBytes: process.resourceUsage().maxRSS * 1024, stats: solver.stats,
}))
