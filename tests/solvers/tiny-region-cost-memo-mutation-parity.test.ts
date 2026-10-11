import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "tiny-hypergraph/lib/core"
import { TinyRegionCostMemo, type TinyRegionCostMethod } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyRegionCostMemo"

test("four-row costs retain native IEEE arithmetic, LRU order and every mutable numeric dependency", (): void => {
  const topology = {
    regionCount: 3, portCount: 2, regionIncidentPorts: [[0, 1], [], []], incidentPortRegion: [[0], [0]],
    regionWidth: new Float64Array([2.2, 0.9797031915038824, 0.4]), regionHeight: new Float64Array([1.7, 1, 0.6]),
    regionCenterX: new Float64Array(3), regionCenterY: new Float64Array(3),
    regionAvailableZMask: new Int32Array([3, 3, 63]), portX: new Float64Array([0, 1]),
    portY: new Float64Array(2), portZ: new Int32Array([0, 1]), portAngleForRegion1: new Int32Array([0, 18000]),
  }
  const problem = { routeCount: 1, routeStartPort: new Int32Array([0]), routeEndPort: new Int32Array([1]),
    routeNet: new Int32Array([0]), regionNetId: new Int32Array(3).fill(-1), portSectionMask: new Int8Array(2) }
  const solver = new TinyHyperGraphSolver(topology, problem, { minViaPadDiameter: 0.37, TRACE_DENSITY_COST_FACTOR: 0.4 })
  const native = (solver as unknown as { computeRegionCostForRegion: TinyRegionCostMethod }).computeRegionCostForRegion.bind(solver)
  const memo = new TinyRegionCostMemo(solver, native)
  memo.collectDiagnostics = true
  const verify = (region: number, tuple: readonly number[]): void => {
    const [same, cross, changes, count] = tuple as [number, number, number, number]
    const expected = native(region, same, cross, changes, count)
    expect(Object.is(memo.get(region, same, cross, changes, count), expected)).toBe(true)
    const before = memo.diagnostics.hits
    expect(Object.is(memo.get(region, same, cross, changes, count), expected)).toBe(true)
    if (Number.isInteger(region) && region >= 0 && region < 3) expect(memo.diagnostics.hits).toBe(before + 1)
  }
  const tuples = [[0, 16, 8, 17], [0, -0, 0, 1], [-0, 0, -0, -0], [1, 2, 3, 4], [5, 7, 8, 9]]
  solver.minViaPadDiameter = 0.8860427485778928
  solver.TRACE_DENSITY_COST_FACTOR = 0
  verify(1, tuples[0]!)
  expect(native(1, ...tuples[0] as [number, number, number, number])).toBe(115.6977054903949)
  for (const tuple of tuples.slice(0, 4)) verify(0, tuple)
  const hits = memo.diagnostics.hits
  memo.get(0, ...tuples[1] as [number, number, number, number])
  memo.get(0, ...tuples[4] as [number, number, number, number])
  memo.get(0, ...tuples[0] as [number, number, number, number])
  expect(memo.diagnostics.hits).toBe(hits + 1)
  let randomState = 0x5a712fab
  const next = (): number => {
    randomState ^= randomState << 13
    randomState ^= randomState >>> 17
    randomState ^= randomState << 5
    return randomState >>> 0
  }
  const exceptional = [0, -0, 0.5, -2.25, Infinity, -Infinity, NaN]
  const policies = [0, -0, 0.3, 0.8860427485778928, Infinity, -Infinity, NaN, undefined, null]
  const masks = [0, -0, 1, 3, 63, -2147483648, 2147483648, 4294967296, 0.5, NaN, Infinity]
  for (let cycle = 0; cycle < 12_000; cycle++) {
    const region = next() % 3
    if (cycle % 3 === 0) solver.minViaPadDiameter = policies[next() % policies.length] as number
    if (cycle % 5 === 0) solver.TRACE_DENSITY_COST_FACTOR = policies[next() % policies.length] as number
    if (cycle % 7 === 0) topology.regionWidth[region] = exceptional[next() % exceptional.length]!
    if (cycle % 11 === 0) topology.regionHeight[region] = exceptional[next() % exceptional.length]!
    if (cycle % 13 === 0) {
      const replacement = Float64Array.from(topology.regionAvailableZMask)
      replacement[region] = masks[next() % masks.length]!
      topology.regionAvailableZMask = replacement as unknown as typeof topology.regionAvailableZMask
    }
    if (cycle % 17 === 0) { topology.regionWidth = topology.regionWidth.slice(); topology.regionHeight = topology.regionHeight.slice() }
    const tuple = Array.from({ length: 4 }, (): number => next() % 5 === 0 ? exceptional[next() % exceptional.length]! : next() % 128)
    verify(region, tuple)
    if (cycle % 23 === 0) verify(region, tuples[next() % tuples.length]!)
    if (cycle % 101 === 0) {
      solver.resetForProblem({ ...problem, routeNet: new Int32Array([cycle]) })
      verify(region, tuple)
    }
  }
  for (const region of [-1, 0.5, 3, NaN, Infinity]) verify(region, tuples[0]!)
  expect(memo.diagnostics.hits).toBeGreaterThan(12_000)
  expect(memo.diagnostics.misses).toBeGreaterThan(100)
  expect(memo.diagnostics.policyInvalidations).toBeGreaterThan(100)
  expect(memo.diagnostics.geometryInvalidations).toBeGreaterThan(100)
  expect(memo.diagnostics.unsupported).toBe(10)
})
