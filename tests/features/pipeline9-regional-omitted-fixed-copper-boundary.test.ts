import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import {
  createRegionalFallbackProblem,
  type RegionalFallbackProblem,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9RegionalFallback"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"

type CandidateCase = {
  rootConnectionName: string
  route: HighDensityRoute["route"]
  hasForeignConflict: boolean
}

test("regional output omission preserves exact fixed copper and rejects a conflicting foreign candidate", (): void => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "omitted-fixed-copper",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: [],
  }
  const fixed: PreloadedHighDensityRoute = {
    connectionName: "fixed",
    rootConnectionName: "fixed-root",
    preloadedTraceIndex: 0,
    preloadedRouteIndex: 0,
    preloadedRoutePositionStart: 0,
    preloadedRoutePositionEnd: 1,
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: -2, y: 0, z: 0, pcb_port_id: "fixed-start" },
      { x: 2, y: 0, z: 0, pcb_port_id: "fixed-end" },
    ],
    vias: [],
  }
  const fixedBefore: PreloadedHighDensityRoute = structuredClone(fixed)
  const candidateCases: CandidateCase[] = [
    {
      rootConnectionName: "fixed-root",
      route: [
        { x: -1, y: 0.01, z: 0 },
        { x: 1, y: 0.01, z: 0 },
      ],
      hasForeignConflict: false,
    },
    {
      rootConnectionName: "foreign-root",
      route: [
        { x: -1, y: 0.6, z: 0 },
        { x: 1, y: 0.6, z: 0 },
      ],
      hasForeignConflict: false,
    },
    {
      rootConnectionName: "foreign-root",
      route: [
        { x: 0, y: -1, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
      hasForeignConflict: true,
    },
  ]
  for (const candidateCase of candidateCases) {
    const candidate: HighDensityRoute = {
      connectionName: "candidate",
      rootConnectionName: candidateCase.rootConnectionName,
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: candidateCase.route,
      vias: [],
    }
    const candidateBefore: HighDensityRoute = structuredClone(candidate)
    const connMap: ConnectivityMap = new ConnectivityMap({})
    const problem: RegionalFallbackProblem = createRegionalFallbackProblem(
      node,
      [fixed],
    )
    expect([...problem.fixedRouteSectionsByConnectionName.keys()]).toEqual([
      fixed.connectionName,
    ])
    const solver: Pipeline9HighDensitySolver = new Pipeline9HighDensitySolver({
      nodePortPoints: [],
      fixedHdRoutes: [fixed],
      connMap,
      obstacles: [],
      layerCount: 2,
      viaDiameter: 0.3,
      traceWidth: 0.15,
      obstacleMargin: 0.15,
      effort: 1,
    })
    const regional: Pipeline9RegionalFallbackSolver =
      new Pipeline9RegionalFallbackSolver({
        nodeWithPortPoints: problem.nodeWithPortPoints,
        connMap,
        colorMap: {},
        obstacles: [],
        layerCount: 2,
        viaDiameter: 0.3,
        traceWidth: 0.15,
        obstacleMargin: 0.15,
        effort: 1,
      })
    // Exercise the completed regional-output boundary without routing a board.
    regional.highDensitySolver.routes.push(candidate)
    regional.solved = true
    solver.activeNode = node
    solver.activeFallbackSolver = regional
    solver.activeFallbackFixedRouteSections = new Map(
      problem.fixedRouteSectionsByConnectionName,
    )
    solver.activeFallbackPromotedFixedRouteConnectionNames.add(
      fixed.connectionName,
    )

    solver._step()

    expect(solver.failed).toBe(candidateCase.hasForeignConflict)
    if (candidateCase.hasForeignConflict) {
      expect(solver.error).toBe(
        "Pipeline9 promoted regional fallback could not resolve immutable fixed route conflict(s): fixed",
      )
      expect(solver.routes).toEqual([])
      expect(solver.stats.solvedNodeCount).toBe(0)
    } else {
      expect(solver.error).toBeNull()
      expect(solver.routes).toEqual([candidateBefore])
      expect(solver.stats.solvedNodeCount).toBe(1)
      expect(solver.stats.reroutedFixedRouteCount).toBe(0)
      expect(solver.stats.reroutedFixedRouteSectionCount).toBe(0)
    }
    expect(solver.fixedRouteReplacements.size).toBe(0)
    expect(solver.removedFixedRouteConnectionNames.size).toBe(0)
    expect(solver.preloadedTraceMutationMasks.size).toBe(0)
    expect(solver.getUpdatedFixedHdRoutes()).toEqual([fixedBefore])
    expect(fixed).toEqual(fixedBefore)
    expect(candidate).toEqual(candidateBefore)
  }
})
