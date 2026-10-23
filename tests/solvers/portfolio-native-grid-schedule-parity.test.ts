import { expect, test } from "bun:test"
import { findRouteGeometryViolations } from "@tscircuit/high-density-a13"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import hardNode from "../fixtures/a13-srj18-hard-node.json"

test("lazy native materialization preserves a crowded multilayer candidate schedule, effort, routes and physical guards", (): void => {
  const node: NodeWithPortPoints = { ...structuredClone(hardNode), availableZ: [0, 1, 2, 3] }
  const originalNode = structuredClone(node)
  const params = { nodeWithPortPoints: node, traceWidth: 0.1, viaDiameter: 0.3, obstacleMargin: 0.15, layerCount: 4, effort: 1, enableNegotiatedSearch: true, gridSearchSegmentWork: 500, gridSearchWorkScale: 0.25, captureSearchDebug: false, cacheProvider: null }
  const eager = new PortfolioSingleIntraNodeSolver({ ...params, deferNativeGridMaterialization: false })
  const deferred = new PortfolioSingleIntraNodeSolver(params)
  while (!eager.solved && !eager.failed) {
    eager.step()
    deferred.step()
    expect(deferred.activeSubSolver?.getSolverName()).toBe(eager.activeSubSolver?.getSolverName())
    expect(deferred.MAX_ITERATIONS).toBe(eager.MAX_ITERATIONS)
    expect(deferred.stats).toEqual(eager.stats)
    expect(node).toEqual(originalNode)
    expect(deferred.supervisedSolvers!.map(({ hyperParameters, solver, f, g, h }) => ({ hyperParameters, name: solver.getSolverName(), iterations: solver.iterations, limit: solver.MAX_ITERATIONS, progress: solver.progress, solved: solver.solved, failed: solver.failed, error: solver.error, f, g, h }))).toEqual(eager.supervisedSolvers!.map(({ hyperParameters, solver, f, g, h }) => ({ hyperParameters, name: solver.getSolverName(), iterations: solver.iterations, limit: solver.MAX_ITERATIONS, progress: solver.progress, solved: solver.solved, failed: solver.failed, error: solver.error, f, g, h })))
  }
  expect(eager.solved).toBe(true)
  expect(deferred.solved).toBe(true)
  expect(deferred.failed).toBe(false)
  expect(deferred.iterations).toBe(eager.iterations)
  expect(deferred.winningSolver?.getSolverName()).toBe(eager.winningSolver?.getSolverName())
  expect(deferred.solvedRoutes).toEqual(eager.solvedRoutes)
  expect(deferred.solvedRoutes).toHaveLength(26)
  expect(findRouteGeometryViolations(deferred.solvedRoutes.map((route) => ({ ...route, traceThickness: route.traceThickness + 0.1, viaDiameter: route.viaDiameter + 0.1 })))).toEqual([])
  expect(deferred.nativeGridSetupDiagnostics.deferredCandidateCount).toBeGreaterThan(0)
  expect(deferred.nativeGridSetupDiagnostics.materializedCandidateCount).toBeGreaterThan(0)
  expect(deferred.nativeGridSetupDiagnostics.selectedCandidateCount).toBe(eager.nativeGridSetupDiagnostics.selectedCandidateCount)
  expect(deferred.nativeGridSetupDiagnostics.materializedCandidateCount).toBeLessThanOrEqual(deferred.nativeGridSetupDiagnostics.deferredCandidateCount)
  expect(deferred.nodeWithPortPoints).toEqual(originalNode)
})
