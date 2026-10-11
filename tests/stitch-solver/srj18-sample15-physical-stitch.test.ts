import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types/srj-types"
import { evaluateConnectionCoverage } from "../../scripts/parallel-benchmark/parallelBenchmarkConnectionCoverage"
import fixture from "./fixtures/srj18-sample15-physical-stitch.json"

test("sample15 retains its terminal bridge before selecting a physical path through route islands", (): void => {
  const params: ConstructorParameters<typeof MultipleHighDensityRouteStitchSolver3>[0] = structuredClone(fixture)
  const solver = new MultipleHighDensityRouteStitchSolver3(params)
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.mergedHdRoutes).toHaveLength(1)
  const route = solver.mergedHdRoutes[0]!
  expect(route.startPcbPortId).toBe("pcb_port_87")
  expect(route.endPcbPortId).toBe("pcb_port_281")
  expect(route.route[0]).toMatchObject({ x: -23.269, y: -6.574, z: 0 })
  expect(route.route.at(-1)).toMatchObject({ x: -23.044, y: -6.32, z: 3 })
  const srj: SimpleRouteJson = { layerCount: params.layerCount, minTraceWidth: 0.1,
    bounds: { minX: -25, maxX: -15, minY: -10, maxY: 0 }, obstacles: [], connections: params.connections }
  expect(evaluateConnectionCoverage(srj, convertToCircuitJson(srj, solver.mergedHdRoutes, {
    originalSrj: srj, includeOriginalConnections: true,
  })).summary.errorCount).toBe(0)
})
