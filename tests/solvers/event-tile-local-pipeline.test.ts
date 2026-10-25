import { expect, test } from "bun:test"
import { findRouteGeometryViolations } from "@tscircuit/high-density-a13"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9RegularNodeSolver, Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { HighDensitySolverA13EventTiles } from "lib/solvers/HyperHighDensitySolver/HighDensitySolverA13EventTiles"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("ordinary local Pipeline9 propagates event search through grow/shrink and accepts physically valid multilayer output", (): void => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "local-event-search",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: [
      { connectionName: "a", x: -1, y: 0, z: 0 },
      { connectionName: "a", x: 1, y: 0, z: 1 },
    ],
  }
  const common = {
    nodeWithPortPoints: node,
    connMap: new ConnectivityMap({ root: ["a"] }),
    colorMap: {},
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 1,
    nodePfById: {},
    obstacles: [],
    layerCount: 2,
  }
  // Projected network requests omit the local-context gate. Captured local
  // factory inputs carry that same gate and need no replay-specific override.
  expect(createPipeline9RegularNodeSolver(common).eventSearch).toBe(false)
  expect(createPipeline9RegularNodeSolver({ ...common, priorityDagSearch: true }).eventSearch).toBe(true)
  expect(createPipeline9RegularNodeSolver({ ...common, priorityDagSearch: true, eventSearch: false }).eventSearch).toBe(false)
  const pipeline = new Pipeline9HighDensitySolver({
    ...common,
    nodePortPoints: [node],
    fixedHdRoutes: [],
    enableRegionalFallback: false,
  })
  pipeline.step()
  const regular = pipeline.activeRegularSolver!
  expect(regular.eventSearch).toBe(true)
  regular.step()
  const grow = regular.activeSubSolver
  expect(grow).toBeInstanceOf(GrowShrinkHighDensityIntraNodeSolver)
  const ownedGrow = grow as GrowShrinkHighDensityIntraNodeSolver
  Reflect.get(ownedGrow, "createActiveSubSolver").call(ownedGrow)
  const portfolio = ownedGrow.activeSubSolver!
  const candidate = portfolio.generateSolver({ HIGH_DENSITY_A13: true })
  expect(candidate).toBeInstanceOf(HighDensitySolverA13EventTiles)
  // Isolate the negotiated candidate to test the entire production acceptance
  // chain without requiring cheap competing solvers to exhaust their budgets.
  portfolio.supervisedSolvers = [{ solver: candidate, hyperParameters: { HIGH_DENSITY_A13: true }, g: 0, h: 0, f: 0 }]
  pipeline.solve()
  const eventCandidate = candidate as unknown as HighDensitySolverA13EventTiles
  expect(pipeline.solved).toBe(true)
  expect(pipeline.failed).toBe(false)
  expect(pipeline.routes).toHaveLength(1)
  expect(pipeline.routes[0]!.route[0]).toMatchObject(node.portPoints[0]!)
  expect(pipeline.routes[0]!.route.at(-1)).toMatchObject(node.portPoints[1]!)
  expect(pipeline.routes[0]!.route.every((point) => node.availableZ!.includes(point.z))).toBe(true)
  expect(findRouteGeometryViolations(pipeline.routes)).toEqual([])
  expect(eventCandidate.stats.boardDrcIssueCount).toBe(0)
  expect(eventCandidate.stats.eventSearchKernelInstalled).toBe(1)
  expect(pipeline.benchmarkDiagnosticCounters.eventSearchQueries).toBeGreaterThan(0)
  expect(pipeline.benchmarkDiagnosticCounters.eventSearchCompressedQueries).toBeGreaterThan(0)
  expect(pipeline.benchmarkDiagnosticCounters.eventSearchEventStates).toBeLessThan(pipeline.benchmarkDiagnosticCounters.eventSearchDenseStates!)
  expect(pipeline.benchmarkDiagnosticCounters.eventSearchMacroTransitions).toBeGreaterThan(0)
})
