import { expect, test } from "bun:test"
import { InMemoryCache } from "lib/cache/InMemoryCache"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import type { SimpleRouteJson } from "lib/types"
import sampleSrj from "../../fixtures/bug-reports/bugreport73-qfp16/bugreport73-qfp16.srj.json" with {
  type: "json",
}

const solveThroughTopologyGeneration = (
  srj: SimpleRouteJson,
  cacheProvider: InMemoryCache,
): AutoroutingPipelineSolver9_PreloadedTraceGraph => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider,
  })
  solver.solveUntilPhase("necessaryCrampedPortPointSolver")
  return solver
}

test("Pipeline9 reuses topology and raw port points across phased inputs", () => {
  const cacheProvider = new InMemoryCache()
  const srj = sampleSrj as SimpleRouteJson
  const firstSolver = solveThroughTopologyGeneration(
    structuredClone(srj),
    cacheProvider,
  )

  const nextPhaseSrj = structuredClone(srj)
  nextPhaseSrj.connections = nextPhaseSrj.connections.slice(0, 1)
  nextPhaseSrj.traces = []
  const secondSolver = solveThroughTopologyGeneration(
    nextPhaseSrj,
    cacheProvider,
  )

  const changedBoardSrj = structuredClone(nextPhaseSrj)
  changedBoardSrj.bounds.maxX += 1
  const changedBoardSolver = solveThroughTopologyGeneration(
    changedBoardSrj,
    cacheProvider,
  )

  expect(firstSolver.topologyCacheHit).toBeFalse()
  expect(secondSolver.topologyCacheHit).toBeTrue()
  expect(changedBoardSolver.topologyCacheHit).toBeFalse()
  expect(secondSolver.topologyPlanningSolver).toBeUndefined()
  expect(secondSolver.availableSegmentPointSolver).toBeUndefined()
  expect(cacheProvider.cacheMissesByPrefix["pipeline9-topology"]).toBe(2)
  expect(cacheProvider.cacheHitsByPrefix["pipeline9-topology"]).toBe(1)
  expect(secondSolver.capacityNodes).toEqual(firstSolver.capacityNodes)
  expect(secondSolver.capacityEdges).toEqual(firstSolver.capacityEdges)
  expect(
    secondSolver.sharedEdgeSegmentsBeforeNecessaryCrampedPortPoints,
  ).toEqual(
    firstSolver.sharedEdgeSegmentsBeforeNecessaryCrampedPortPoints,
  )
})
