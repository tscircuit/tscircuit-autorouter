import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  createPipeline9RegularNodeSolver,
  Pipeline9HighDensitySolver,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { priorityParams } from "./priorityDagTestUtils"

test("only owned Pipeline9 Native factories opt into bitmap membership without changing hyperparameter work", (): void => {
  const params = priorityParams()
  const connMap = new ConnectivityMap({})
  const shared = createPipeline9RegularNodeSolver({
    nodeWithPortPoints: params.nodeWithPortPoints,
    connMap,
    colorMap: {},
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.1,
    effort: 1,
    nodePfById: {},
    obstacles: [],
    layerCount: 2,
  })
  expect(shared.priorityDagOptions.nativeExplorationBitmap).toBe(false)
  const owned = new Pipeline9HighDensitySolver({
    nodePortPoints: [params.nodeWithPortPoints],
    connMap,
    fixedHdRoutes: [],
    colorMap: {},
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.1,
    effort: 1,
    obstacles: [],
    layerCount: 2,
  })
  owned.step()
  expect(
    owned.activeRegularSolver?.priorityDagOptions.nativeExplorationBitmap,
  ).toBe(true)
  const control = new PriorityDagIntraNodeSolver(params)
  const mirrored = new PriorityDagIntraNodeSolver({
    ...params,
    nativeExplorationBitmap: true,
  })
  expect(mirrored.hyperParameters).toEqual(control.hyperParameters)
  expect(mirrored.iterations).toBe(control.iterations)
  expect(mirrored.MAX_ITERATIONS).toBe(control.MAX_ITERATIONS)
  control.solve()
  mirrored.solve()
  expect(mirrored.iterations).toBe(control.iterations)
  expect(mirrored.priorityDiagnostics).toEqual(control.priorityDiagnostics)
  expect(mirrored.solvedRoutes).toEqual(control.solvedRoutes)
  const portfolio = new PortfolioSingleIntraNodeSolver({
    ...params,
    nativeExplorationBitmap: true,
  })
  const plain = portfolio.generateSolver({ CELL_SIZE_FACTOR: 2 })
  const dag = portfolio.generateSolver({
    PRIORITY_DAG_FAMILY_SIZE: 1,
    CELL_SIZE_FACTOR: 2,
  })
  expect(plain).toBeInstanceOf(IntraNodeRouteSolver)
  expect(dag).toBeInstanceOf(PriorityDagIntraNodeSolver)
  expect((plain as IntraNodeRouteSolver).nativeExplorationBitmap).toBe(true)
  expect((dag as PriorityDagIntraNodeSolver).nativeExplorationBitmap).toBe(true)
})
