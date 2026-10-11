import { expect, test } from "bun:test"
import { TinyIndependentRegionCostIndex } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyIndependentRegionCostIndex"
import { TinyHyperGraphSolver } from "tiny-hypergraph/lib/core"
import type { TinyBitsetRegionCost } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyBitsetRegionCostCache"

test("independent region costs preserve every native input and invalidate after problem resets", (): void => {
  const topology = {
    regionCount: 1, portCount: 2, regionIncidentPorts: [[0, 1]], incidentPortRegion: [[0], [0]],
    regionWidth: new Float64Array([2.2]), regionHeight: new Float64Array([1.7]),
    regionCenterX: new Float64Array([0]), regionCenterY: new Float64Array([0]),
    regionAvailableZMask: new Int32Array([3]), portX: new Float64Array([0, 1]),
    portY: new Float64Array([0, 0]), portZ: new Int32Array([0, 1]),
    portAngleForRegion1: new Int32Array([0, 18000]),
  }
  const problem = {
    routeCount: 1, routeStartPort: new Int32Array([0]), routeEndPort: new Int32Array([1]),
    routeNet: new Int32Array([0]), regionNetId: new Int32Array([-1]), portSectionMask: new Int8Array(2),
  }
  const solver = new TinyHyperGraphSolver(topology, problem, { minViaPadDiameter: 0.37, TRACE_DENSITY_COST_FACTOR: 0.4 })
  const host = solver as unknown as { computeRegionCostForRegion: TinyBitsetRegionCost }
  const native = host.computeRegionCostForRegion.bind(solver)
  let calls = 0
  const index = new TinyIndependentRegionCostIndex(solver, (...args): number => { calls++; return native(...args) })
  index.collectDiagnostics = true
  index.reset()
  const verify = (): void => {
    for (const change of [0, 1]) {
      const expected = native(0, 0, 0, change, 1)
      expect(Object.is(index.get(0, 0, 0, change, 1), expected)).toBe(true)
      const before = calls
      expect(Object.is(index.get(0, 0, 0, change, 1), expected)).toBe(true)
      expect(calls).toBe(before)
    }
  }
  verify()
  topology.regionWidth[0] = 0.73; verify()
  topology.regionHeight[0] = 0.48; verify()
  topology.regionAvailableZMask[0] = 1; verify()
  solver.minViaPadDiameter = 0.24; verify()
  solver.TRACE_DENSITY_COST_FACTOR = 0.9; verify()
  solver.resetForProblem({ ...problem, routeNet: new Int32Array([7]) })
  index.reset()
  const beforeResetRead = calls
  verify()
  expect(calls).toBe(beforeResetRead + 2)
  for (const tuple of [[1, 0, 0, 1], [0, 2, 1, 1], [0, 0, 2, 1], [0, 0, 1, 5]]) {
    const [same, cross, changes, count] = tuple as [number, number, number, number]
    const before = calls
    expect(Object.is(index.get(0, same, cross, changes, count), native(0, same, cross, changes, count))).toBe(true)
    expect(calls).toBe(before + 1)
  }
  expect(index.diagnostics.hits).toBeGreaterThan(0)
  expect(index.diagnostics.misses).toBeGreaterThan(0)
})
