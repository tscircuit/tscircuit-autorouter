import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types/srj-types"
import { evaluateConnectionCoverage } from "../../scripts/parallel-benchmark/parallelBenchmarkConnectionCoverage"
import fixture from "./fixtures/srj18-sample15-terminal-tail.json"

test("sample15 keeps its bottom terminal tail instead of synthesizing a top wire across foreign pads", (): void => {
  const params = structuredClone(fixture) as ConstructorParameters<typeof MultipleHighDensityRouteStitchSolver3>[0]
  const solver = new MultipleHighDensityRouteStitchSolver3(params)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoutes).toHaveLength(1)
  const route = solver.mergedHdRoutes[0]!
  const points = route.startPcbPortId === "pcb_port_413" ? route.route : route.route.toReversed()
  expect(points[0]).toMatchObject({ x: -19.96, y: -10.3, z: 3 })
  const transitionIndex = points.findIndex((point, index) => index > 0 && point.z !== points[index - 1]!.z)
  expect(transitionIndex).toBeGreaterThan(0)
  expect(points[transitionIndex - 1]).toMatchObject({ x: -20.295, y: -10.3, z: 3 })
  expect(points[transitionIndex]).toMatchObject({ x: -20.295, y: -10.3, z: 1 })
  expect(route.vias).toContainEqual({ x: -20.295, y: -10.3 })
  expect(route.vias).not.toContainEqual({ x: -19.96, y: -10.3 })
  expect(points.slice(0, transitionIndex).every((point) => point.z === 3)).toBe(true)
  const srj: SimpleRouteJson = { layerCount: params.layerCount, minTraceWidth: 0.1,
    bounds: { minX: -25, maxX: -15, minY: -15, maxY: -5 }, obstacles: [], connections: params.connections }
  const coverage = evaluateConnectionCoverage(srj, convertToCircuitJson(srj, solver.mergedHdRoutes, {
    originalSrj: srj, includeOriginalConnections: true,
  })).summary
  expect(coverage.requiredPairCount).toBe(1)
  expect(coverage.coveredNetCount).toBe(1)
  expect(coverage.errorCount).toBe(0)
})
