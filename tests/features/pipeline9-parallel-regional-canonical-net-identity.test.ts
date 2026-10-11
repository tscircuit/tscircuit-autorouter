import { expect, spyOn, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import * as regional from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9RegionalB01Repairs"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import { executeParallelStageJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelStageWorkerJobs"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("regional worker jobs preserve canonical net identity after duplicate-piece aliases merge nets", (): void => {
  const routes: HighDensityRoute[] = [0, 1].map((y): HighDensityRoute => ({
    connectionName: "signal",
    rootConnectionName: "root",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [{ x: -4, y, z: 0 }, { x: 0, y, z: 0 }, { x: 4, y, z: 0 }],
  }))
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -8, maxX: 8, minY: -8, maxY: 8 },
    obstacles: [],
    connections: [{ name: "signal", pointsToConnect: [
      { x: -4, y: 0, layer: "top" }, { x: 4, y: 0, layer: "top" },
    ] }],
  }
  const connMap = new ConnectivityMap({ signal_net: ["signal"], root_net: ["root"] })
  const params = {
    routes, srj, connMap, center: { x: 0, y: 0 }, regionSize: 3,
    colorMap: {}, viaDiameter: 0.3, traceWidth: 0.1, obstacleMargin: 0.15, effort: 1,
  }
  const serialB01 = regional.preparePipeline9RegionalB01Candidate({ ...params, fixedObstacleRoutes: [], routeIndex: 0 })
  if (!serialB01) throw new Error("Expected an intersecting B01 section")
  expect(connMap.getNetConnectedToId("signal")).toBe("signal_net")
  expect(connMap.getNetConnectedToId("signal_regional_0")).toBe("signal_net")
  expect(connMap.netMap.root_net).toBe(connMap.netMap.signal_net)
  // A constructor-only roundtrip changes the canonical identity despite retaining connectivity.
  const constructorOnly = new ConnectivityMap(structuredClone(connMap.netMap))
  expect(constructorOnly.getNetConnectedToId("signal")).toBe("root_net")
  const connectivityNetMap = structuredClone(connMap.netMap)
  const connectivityIdToNetMap = structuredClone(connMap.idToNetMap)
  const serialFallback = regional.preparePipeline9RegularRegionalCandidate({
    ...params, fixedRouteCopperSpatialIndex: regional.createFixedRouteCopperSpatialIndex([], srj),
  })
  if (!serialFallback) throw new Error("Expected perimeter terminals for a regular region")
  let workerB01: regional.Pipeline9RegionalB01CandidateProblem | undefined
  const prepareB01 = regional.preparePipeline9RegionalB01Candidate
  const b01Spy = spyOn(regional, "preparePipeline9RegionalB01Candidate").mockImplementation((workerParams) => {
    workerB01 = prepareB01(workerParams)
    if (!workerB01) throw new Error("Worker lost its intersecting B01 section")
    const solver = workerB01.solver
    solver.solve = (): void => {
      solver.failed = true
      solver.error = "Stop after inspecting prepared connectivity"
      solver.solved = false
      solver.activeSubSolver = null
      solver.iterations = 0
      solver.progress = 0
    }
    return workerB01
  })
  let workerFallbackConnMap: ConnectivityMap | undefined
  const fallbackSpy = spyOn(Pipeline9RegionalFallbackSolver.prototype, "_step").mockImplementation(function (this: Pipeline9RegionalFallbackSolver): void {
    workerFallbackConnMap = this.params.connMap
    this.failed = true
    this.error = "Stop after inspecting prepared connectivity"
    this.solved = false
    this.activeSubSolver = null
    this.progress = 0
  })
  try {
    const { connMap: _b01ConnMap, ...b01Params } = { ...params, fixedObstacleRoutes: [], routeIndex: 0 }
    const b01Result = executeParallelStageJob(structuredClone({
      kind: "regionalB01Candidate" as const, params: b01Params,
      connectivityNetMap, connectivityIdToNetMap,
    }))
    expect(b01Result).toMatchObject({ kind: "regionalB01Candidate", status: "prepared", replacement: undefined })
    if (!workerB01) throw new Error("Worker did not prepare its B01 candidate")
    expect(workerB01.solver.fixedHdRoutes.map((route) => route.rootConnectionName))
      .toEqual(serialB01.solver.fixedHdRoutes.map((route) => route.rootConnectionName))
    const { connMap: _fallbackConnMap, ...fallbackParams } = serialFallback.solver.params
    const fallbackResult = executeParallelStageJob(structuredClone({
      kind: "regionalFallbackSolve" as const, params: fallbackParams,
      connectivityNetMap, connectivityIdToNetMap,
    }))
    expect(fallbackResult).toMatchObject({ kind: "regionalFallbackSolve", status: "prepared", solved: false, failed: true })
    if (!workerFallbackConnMap) throw new Error("Worker did not prepare its regular candidate")
    for (const id of ["signal", "root", "signal_regional_0", "signal_regional_1"]) {
      expect(workerFallbackConnMap.getNetConnectedToId(id)).toBe(connMap.getNetConnectedToId(id))
    }
    expect(workerFallbackConnMap.netMap.root_net).toBe(workerFallbackConnMap.netMap.signal_net)
  } finally {
    b01Spy.mockRestore()
    fallbackSpy.mockRestore()
  }
})
