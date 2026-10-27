import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9RegularNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import witness from "./growth-witness.json"

test("sparse search keeps actual widths in the original frame instead of publishing relaxed scaled copper", (): void => {
  const oldInner: HighDensityRoute[] = witness.innerTargetRoutes
  const oldReturned: HighDensityRoute[] = witness.acceptedTargetRoutes
  expect(
    doPipeline9RoutesHaveCopperConflict({
      left: oldInner[0],
      right: oldInner[1],
      clearance: 0.1,
      layerCount: 2,
    }),
  ).toBe(false)
  expect(
    doPipeline9RoutesHaveCopperConflict({
      left: oldReturned[0],
      right: oldReturned[1],
      clearance: 0.1,
      layerCount: 2,
    }),
  ).toBe(true)
  const node: NodeWithPortPoints = witness.originalNode
  const netMap: Record<string, string[]> = {}
  for (const port of node.portPoints) {
    const root = port.rootConnectionName ?? port.connectionName
    netMap[root] ??= []
    if (!netMap[root].includes(port.connectionName))
      netMap[root].push(port.connectionName)
  }
  const solver = createPipeline9RegularNodeSolver({
    nodeWithPortPoints: structuredClone(node),
    connMap: new ConnectivityMap(netMap),
    colorMap: {},
    viaDiameter: witness.viaDiameter,
    traceWidth: witness.traceWidth,
    obstacleMargin: witness.obstacleMargin,
    effort: 1,
    nodePfById: {},
    obstacles: [],
    layerCount: 2,
    priorityDagSearch: true,
    sparsePhysicalSearch: true,
  })
  const previous = PriorityDagIntraNodeSolver.detailedWorkDiagnostics
  PriorityDagIntraNodeSolver.detailedWorkDiagnostics = true
  try {
    solver.solve()
    expect(
      solver.benchmarkDiagnosticCounters.prioritySparseSearches,
    ).toBeGreaterThan(0)
    expect(solver.benchmarkDiagnosticCounters.priorityScaledInstances).toBe(0)
    if (solver.solved) {
      for (let left = 0; left < solver.routes.length; left++) {
        for (let right = left + 1; right < solver.routes.length; right++) {
          const a = solver.routes[left]
          const b = solver.routes[right]
          if (a.rootConnectionName === b.rootConnectionName) continue
          expect(
            doPipeline9RoutesHaveCopperConflict({
              left: a,
              right: b,
              clearance: witness.obstacleMargin,
              layerCount: 2,
            }),
          ).toBe(false)
        }
      }
    } else {
      expect(solver.failed).toBe(true)
      expect(solver.routes).toHaveLength(0)
      expect(solver.error).toContain("UNKNOWN")
    }
  } finally {
    PriorityDagIntraNodeSolver.detailedWorkDiagnostics = previous
  }
})
