import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import nodeFixture from "../fixtures/pipeline9-compute-selection-topology-merge-5329.json"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { ContextualComputeSelectionModel } from "lib/solvers/HyperHighDensitySolver/ContextualComputeSelectionModel"
import { MultiHeadPolyLineIntraNodeSolver3 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"
import { ProjectedBoundaryMultiHeadPolyLineIntraNodeSolver } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/ProjectedBoundaryMultiHeadPolyLineIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { PolyLine2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types2"
import { assessComputeSelectionOutcome } from "lib/solvers/HyperHighDensitySolver/validateComputeSelectionOutcome"

test("the production polyline kernel keeps the captured six-layer boundary trajectory finite without claiming an impossible clearance", (): void => {
  const node: NodeWithPortPoints = structuredClone(nodeFixture)
  const connMap = new ConnectivityMap({})
  for (const point of node.portPoints) connMap.addConnections([[point.connectionName, point.rootConnectionName!]])
  const opts = { nodeWithPortPoints: node, connMap, layerCount: 6, traceWidth: 0.1, viaDiameter: 0.3, obstacleMargin: 0.1 }
  const hyperParameters = { MULTI_HEAD_POLYLINE_SOLVER: true, SEGMENTS_PER_POLYLINE: 6,
    BOUNDARY_PADDING: -0.05, ITERATION_PENALTY: 10000, MINIMUM_FINAL_ACCEPTANCE_GAP: 0.001 }
  const portfolio = new PortfolioSingleIntraNodeSolver({ ...opts, computeSelectionModel: new ContextualComputeSelectionModel() })
  const kernel = portfolio.generateSolver(hyperParameters)
  const native = new PortfolioSingleIntraNodeSolver(opts).generateSolver(hyperParameters)
  expect(native.constructor).toBe(MultiHeadPolyLineIntraNodeSolver3)
  expect(native.hyperParameters).toEqual(kernel.hyperParameters)
  expect(native.MAX_ITERATIONS).toBe(kernel.MAX_ITERATIONS)
  expect(kernel).toBeInstanceOf(ProjectedBoundaryMultiHeadPolyLineIntraNodeSolver)
  const projected = kernel as unknown as ProjectedBoundaryMultiHeadPolyLineIntraNodeSolver
  expect(projected.MAX_ITERATIONS).toBe(1000)
  const original = structuredClone(node)
  while (!projected.solved && !projected.failed) {
    projected.step()
    for (const candidate of [...projected.candidates, ...(projected.lastCandidate ? [projected.lastCandidate] : [])]) {
      expect(candidate.polyLines.every((line) => [line.start, ...line.mPoints, line.end].every((point) => [point.x, point.y, point.z1, point.z2].every(Number.isFinite)))).toBe(true)
      expect(candidate.minGaps.every(Number.isFinite)).toBe(true)
    }
  }
  expect(Number(projected.stats.projectedViaBoundarySteps)).toBeGreaterThan(0)
  expect(Number(projected.stats.projectedViaBoundaryMoves)).toBeGreaterThan(0)
  expect(node).toEqual(original)
  // A via larger than its cell still cannot become a physical certificate.
  // Projection uses the least-violation center; physical validation stays strict.
  const tiny: NodeWithPortPoints = { capacityMeshNodeId: "empty-via-center-domain", center: { x: 0, y: 0 }, width: 0.1, height: 0.1, availableZ: [0, 1],
    portPoints: [{ connectionName: "signal", x: -0.04, y: 0, z: 0 }, { connectionName: "signal", x: 0.04, y: 0, z: 1 }] }
  const bounded = new ProjectedBoundaryMultiHeadPolyLineIntraNodeSolver({ nodeWithPortPoints: tiny, viaDiameter: 0.3 })
  const lines: PolyLine2[] = [{ connectionName: "signal", start: { x: -0.04, y: 0, z1: 0, z2: 0 }, end: { x: 0.04, y: 0, z1: 1, z2: 1 }, mPoints: [{ x: 1000, y: -1000, z1: 0, z2: 1 }] }]
  const endpoints = structuredClone([lines[0]!.start, lines[0]!.end])
  const movement = bounded.applyForcesToPolyLines(lines)
  expect(movement.lastStepMoved).toBe(true)
  expect(Number.isFinite(movement.magForceApplied)).toBe(true)
  expect(lines[0]!.mPoints[0]).toEqual({ x: 0, y: 0, z1: 0, z2: 1 })
  expect([lines[0]!.start, lines[0]!.end]).toEqual(endpoints)
  expect(bounded.stats.projectedViaBoundaryEmptyAxes).toBe(2)
  expect(bounded.solved).toBe(false)
  const routes = [{ connectionName: "signal", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: -0.04, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0.04, y: 0, z: 1 }], vias: [{ x: 0, y: 0 }] }]
  expect(assessComputeSelectionOutcome({ routes, node: tiny, layerCount: 2, traceWidth: 0.1, viaDiameter: 0.3, obstacleMargin: 0.1, obstacles: [],
    boardGeometry: { bounds: { minX: -0.05, maxX: 0.05, minY: -0.05, maxY: 0.05 }, minBoardEdgeClearance: 0 } }).physicallyClean).toBe(false)
})
