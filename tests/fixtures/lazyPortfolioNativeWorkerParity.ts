import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { SolverRuntime } from "@tscircuit/solver-utils/runtime/bun"
import {
  Pipeline9HighDensityBatchSolver,
  type Pipeline9HighDensityBatchInput,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityBatchSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

// Independent batches use distinct net IDs so serial and workers start with
// equivalent cold cache contexts. The assertions compare all returned metadata.
const duplicateCacheContext = process.argv.includes("--duplicate-cache-context")
const reportIndex = process.argv.indexOf("--failure-report")
const failureReportPath = reportIndex >= 0 ? process.argv[reportIndex + 1] : undefined
const inputs: Pipeline9HighDensityBatchInput[] = []
for (let batch = 0; batch < 2; batch++) {
  const identity = duplicateCacheContext ? 0 : batch
  const nodes: NodeWithPortPoints[] = []
  for (let nodeIndex = 0; nodeIndex < 2; nodeIndex++) {
    nodes.push({ capacityMeshNodeId: `native-lazy-${batch}-${nodeIndex}`,
      center: { x: 0, y: 0 }, width: 4, height: 4, availableZ: [0, 1],
      portPoints: [
        { connectionName: `A-${identity}`, x: -2, y: -1, z: 0 },
        { connectionName: `A-${identity}`, x: 2, y: 1, z: 0 },
        { connectionName: `B-${identity}`, x: -2, y: 1, z: nodeIndex },
        { connectionName: `B-${identity}`, x: 2, y: -1, z: nodeIndex },
      ] })
  }
  inputs.push({ nodePortPoints: nodes, fixedHdRoutes: [], connectivityNetMap: { [`netA-${identity}`]: [`A-${identity}`], [`netB-${identity}`]: [`B-${identity}`] },
    colorMap: {}, obstacles: [], layerCount: 2, viaDiameter: 0.3, viaHoleDiameter: 0.2,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.1, traceWidth: 0.1,
    obstacleMargin: 0.15, effort: 1, maxIterations: 1_000_000 })
}
const serial = inputs.map((input) => {
  const solver = new Pipeline9HighDensityBatchSolver(structuredClone(input))
  solver.solve()
  assert.equal(solver.solved, true)
  return solver.getOutput()
})
const runtime = new SolverRuntime({ workerCount: 2, requireWorker: true,
  workerUrl: new URL("../../lib/runtime/bun.worker.ts", import.meta.url) })
try {
  const threaded = await Promise.all(inputs.map((input) =>
    runtime.executeAsync(Pipeline9HighDensityBatchSolver, structuredClone(input))))
  if (failureReportPath && JSON.stringify(threaded) !== JSON.stringify(serial)) {
    const differences = serial.flatMap((batch, batchIndex) => batch.flatMap((node, nodeIndex) => {
      const actual = threaded[batchIndex]![nodeIndex]!
      return JSON.stringify(actual) === JSON.stringify(node) ? [] : [{
        batchIndex, nodeIndex,
        routesMatch: JSON.stringify(actual.routes) === JSON.stringify(node.routes),
        routeRegionIds: { serial: node.routes.map((route) => route.regionId),
          worker: actual.routes.map((route) => route.regionId) },
        work: { serial: node.iterations, worker: actual.iterations },
        deterministicDiagnosticsMatch: JSON.stringify(actual.benchmarkDiagnosticCounters) === JSON.stringify(node.benchmarkDiagnosticCounters),
      }]
    }))
    await Bun.write(failureReportPath, JSON.stringify({
      duplicateCacheContext,
      serialHash: createHash("sha256").update(JSON.stringify(serial)).digest("hex"),
      workerHash: createHash("sha256").update(JSON.stringify(threaded)).digest("hex"),
      differences, serial, threaded,
    }, null, 2))
  }
  assert.equal(JSON.stringify(threaded), JSON.stringify(serial),
    "Routes, winner-derived work, deterministic counters and terminal metadata must match native workers exactly")
  const results = serial.flat()
  assert.equal(results.length, 4)
  assert.ok(results.every((node) => node.solved))
  assert.ok(results.some((node) => node.benchmarkDiagnosticCounters.portfolioLazyDeferredGridSetups > 0))
  console.log(JSON.stringify({ batches: 2, nodes: 4, actualWorkerExecution: true,
    exactOutputAndWorkParity: true,
    deferredGridSetups: results.reduce((sum, node) => sum + node.benchmarkDiagnosticCounters.portfolioLazyDeferredGridSetups, 0),
    unmaterializedGridSetups: results.reduce((sum, node) => sum + node.benchmarkDiagnosticCounters.portfolioLazyUnmaterializedGridSetups, 0) }))
} finally {
  await runtime.dispose()
}
