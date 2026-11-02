import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { InMemoryCache } from "lib/cache/InMemoryCache"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

type InspectableSolver = BaseSolver & {
  failedSolvers?: BaseSolver[]
  supervisedSolvers?: Array<{ solver: BaseSolver }>
}

function countSearchHistory(root: BaseSolver): number {
  const stack: InspectableSolver[] = [root]
  const visited = new Set<BaseSolver>()
  let count = 0
  while (stack.length > 0) {
    const solver = stack.pop()!
    if (visited.has(solver)) continue
    visited.add(solver)
    if (solver.activeSubSolver) stack.push(solver.activeSubSolver)
    stack.push(...(solver.failedSubSolvers ?? []))
    stack.push(...(solver.failedSolvers ?? []))
    for (const candidate of solver.supervisedSolvers ?? []) {
      stack.push(candidate.solver)
    }
    if (solver instanceof SingleHighDensityRouteSolver) {
      count += solver.debug_exploredNodesOrdered.length
    }
  }
  return count
}

test("regional routing preserves debug selection without changing routes or search work", (): void => {
  const portPoints = [
    { x: -1, y: 0, z: 0, connectionName: "horizontal" },
    { x: 1, y: 0, z: 0, connectionName: "horizontal" },
    { x: 0, y: -1, z: 0, connectionName: "vertical" },
    { x: 0, y: 1, z: 0, connectionName: "vertical" },
  ]
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "regional-search-debug",
    center: { x: 0, y: 0 },
    width: 2.1,
    height: 2.1,
    availableZ: [0],
    portPoints,
    portPointsInPairs: [
      [portPoints[0]!, portPoints[1]!],
      [portPoints[2]!, portPoints[3]!],
    ],
  }
  const previousCache = globalThis.TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE
  const results: Pipeline9HighDensitySolver[] = []
  try {
    for (const captureSearchDebug of [false, true, undefined]) {
      globalThis.TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE = new InMemoryCache()
      const solver = new Pipeline9HighDensitySolver({
        nodePortPoints: [structuredClone(node)],
        fixedHdRoutes: [],
        connMap: new ConnectivityMap({}),
        obstacles: [],
        layerCount: 2,
        viaDiameter: 0.3,
        traceWidth: 0.1,
        obstacleMargin: 0.15,
        effort: 0.1,
        captureSearchDebug,
      })
      let sawRegionalSolver = false
      let maximumRegionalHistory = 0
      while (!solver.solved && !solver.failed) {
        solver.step()
        if (solver.activeRegularSolver) {
          expect(solver.activeRegularSolver.captureSearchDebug).toBe(
            captureSearchDebug ?? false,
          )
        }
        if (solver.activeFallbackSolver) {
          sawRegionalSolver = true
          const regional = solver.activeFallbackSolver.highDensitySolver
          expect(regional.captureSearchDebug).toBe(captureSearchDebug ?? true)
          maximumRegionalHistory = Math.max(
            maximumRegionalHistory,
            countSearchHistory(regional),
          )
        }
      }
      expect(sawRegionalSolver).toBeTrue()
      expect(solver.solved).toBeTrue()
      expect(solver.failed).toBeFalse()
      if (captureSearchDebug === false) {
        expect(maximumRegionalHistory).toBe(0)
      } else {
        expect(maximumRegionalHistory).toBeGreaterThan(0)
      }
      results.push(solver)
    }
    for (const solver of results.slice(1)) {
      expect(solver.routes).toEqual(results[0]!.routes)
      expect(solver.iterations).toBe(results[0]!.iterations)
      expect(solver.stats).toEqual(results[0]!.stats)
      expect(solver.visualize()).toEqual(results[0]!.visualize())
    }
  } finally {
    globalThis.TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE = previousCache
  }
})
