import { expect, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils/runtime/node"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { priorityParams } from "../priorityDagTestUtils"

test("owned serial and native worker batches activate the same sparse physical search", async (): Promise<void> => {
  const params = priorityParams()
  const nodePortPoints: NodeWithPortPoints[] = Array.from(
    { length: 4 },
    (_, index): NodeWithPortPoints => ({
      ...params.nodeWithPortPoints,
      capacityMeshNodeId: `region-${index}`,
      center: { x: index * 10, y: 0 },
      portPoints: params.nodeWithPortPoints.portPoints.map(
        (point): typeof point => ({ ...point, x: point.x + index * 10 }),
      ),
    }),
  )
  const input = {
    nodePortPoints,
    connMap: new ConnectivityMap({}),
    fixedHdRoutes: [],
    colorMap: {},
    viaDiameter: 0.3,
    viaHoleDiameter: 0.15,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    actualCopperClearance: 0.3,
    actualViaPadClearance: 0.25,
    layerCount: 2,
    effort: 1,
    obstacles: [],
  }
  const previous = PriorityDagIntraNodeSolver.detailedWorkDiagnostics
  PriorityDagIntraNodeSolver.detailedWorkDiagnostics = true
  try {
    const serial = new Pipeline9HighDensitySolver(input)
    serial.solve()
    expect(serial.solved).toBe(true)
    expect(
      serial.benchmarkDiagnosticCounters.prioritySparseSearches,
    ).toBeGreaterThan(0)
    for (const workerCount of [1, 4]) {
      const runtime = new SolverRuntime({
        workerCount,
        workerUrl: new URL("./worker.ts", import.meta.url),
        requireWorker: true,
      })
      try {
        const parallel = new Pipeline9HighDensitySolver(input)
        await parallel.solveAsync(runtime)
        expect(parallel.solved).toBe(true)
        expect(parallel.routes).toEqual(serial.routes)
        expect(
          parallel.benchmarkDiagnosticCounters.prioritySparseSearches,
        ).toBe(serial.benchmarkDiagnosticCounters.prioritySparseSearches)
        expect(parallel.benchmarkDiagnosticCounters.prioritySparseWork).toBe(
          serial.benchmarkDiagnosticCounters.prioritySparseWork,
        )
        expect(
          parallel.benchmarkDiagnosticCounters.priorityWorkerNodesCompleted,
        ).toBe(4)
      } finally {
        await runtime.dispose()
      }
    }
  } finally {
    PriorityDagIntraNodeSolver.detailedWorkDiagnostics = previous
  }
})
