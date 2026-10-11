import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types/srj-types"
import { evaluateConnectionCoverage } from "../../scripts/parallel-benchmark/parallelBenchmarkConnectionCoverage"
import fixture from "./fixtures/srj18-sample14-physical-stitch.json"

test("sample14 keeps the declared distinct PCB terminals when an island loops near one pad", (): void => {
  const params: ConstructorParameters<typeof MultipleHighDensityRouteStitchSolver3>[0] = structuredClone(fixture)
  const solver = new MultipleHighDensityRouteStitchSolver3(params)
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.mergedHdRoutes).toHaveLength(1)
  const route = solver.mergedHdRoutes[0]!
  expect(route.startPcbPortId).toBe("pcb_port_332")
  expect(route.endPcbPortId).toBe("pcb_port_191")
  expect(route.route[0]).toMatchObject({ x: -36.2075, y: 0.214, z: 3 })
  expect(route.route.at(-1)).toMatchObject({ x: -36.553336, y: 1.0763, z: 0 })
  const srj: SimpleRouteJson = { layerCount: params.layerCount, minTraceWidth: 0.1,
    bounds: { minX: -40, maxX: -30, minY: -5, maxY: 5 }, obstacles: [], connections: params.connections }
  expect(evaluateConnectionCoverage(srj, convertToCircuitJson(srj, solver.mergedHdRoutes, {
    originalSrj: srj, includeOriginalConnections: true,
  })).summary.errorCount).toBe(0)
})
