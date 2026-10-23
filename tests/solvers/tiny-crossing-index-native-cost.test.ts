import { expect, test } from "bun:test"
import { TinyHyperGraphSolver, type Candidate, type TinyHyperGraphProblem, type TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"
import { DistanceAwareTinyHyperGraphSolver } from "tiny-hypergraph/lib/distance-aware-tiny-hypergraph-solver"
import { installTinyCrossingIndex } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/installTinyCrossingIndex"
import { createTinyCrossingIndexDiagnostics } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyRegionCrossingIndex"

test("indexed native g costs preserve every floating result and bound with both port incidences", (): void => {
  const portCount = 70
  const topology: TinyHyperGraphTopology = {
    portCount, regionCount: 2,
    regionIncidentPorts: [Array.from({ length: portCount }, (_, i) => i), Array.from({ length: portCount }, (_, i) => i)],
    incidentPortRegion: Array.from({ length: portCount }, (_, i) => i % 2 ? [1, 0] : [0, 1]),
    regionWidth: new Float64Array([2.137, 0.731]), regionHeight: new Float64Array([3.413, 0.917]),
    regionCenterX: new Float64Array(2), regionCenterY: new Float64Array(2), regionAvailableZMask: new Int32Array([15, 1]),
    portAngleForRegion1: Int32Array.from({ length: portCount }, (_, i) => (i % 17 - 8) * 100),
    portAngleForRegion2: Int32Array.from({ length: portCount }, (_, i) => (i % 19 - 9) * 100),
    portX: Float64Array.from({ length: portCount }, (_, i) => Math.sin(i) * 0.713),
    portY: Float64Array.from({ length: portCount }, (_, i) => Math.cos(i) * 0.931),
    portZ: Int32Array.from({ length: portCount }, (_, i) => i % 4),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 3, portSectionMask: new Int8Array(portCount).fill(1),
    routeStartPort: new Int32Array([0, 1, 2]), routeEndPort: new Int32Array([67, 68, 69]), routeNet: new Int32Array([3, 7, 31]), regionNetId: new Int32Array(2).fill(-1),
    portPenalty: Float64Array.from({ length: portCount }, (_, i) => i * 0.0137),
  }
  const diagnostics = createTinyCrossingIndexDiagnostics(true)
  for (const Constructor of [TinyHyperGraphSolver, DistanceAwareTinyHyperGraphSolver]) for (const length of [0, 1, 32, 65]) {
    const native = new Constructor(topology, structuredClone(problem), { TRACE_DENSITY_COST_FACTOR: 0.731, minViaPadDiameter: 0.413, DISTANCE_TO_COST: 0.137 })
    const indexed = new Constructor(topology, structuredClone(problem), { TRACE_DENSITY_COST_FACTOR: 0.731, minViaPadDiameter: 0.413, DISTANCE_TO_COST: 0.137 })
    installTinyCrossingIndex(indexed, diagnostics)
    for (const solver of [native, indexed]) {
      for (let segment = 0; segment < length; segment++) {
        solver.state.currentRouteNetId = segment % 3 === 0 ? 3 : 7
        solver.appendSegmentToRegionCache(segment % 2, segment % portCount, (segment * 3 + 11) % portCount)
      }
      solver.state.regionCongestionCost.set([0.173, 0.319])
      solver.state.currentRouteNetId = 3
    }
    for (const region of [0, 1]) for (let from = 0; from < portCount; from++) for (let to = 0; to < portCount; to++) {
      const candidate: Candidate = { portId: from, nextRegionId: region, g: (from % 3) * 0.117, h: 0, f: 0 }
      for (const maximum of [Infinity, candidate.g, candidate.g + 0.5]) {
        const distance = to % 2 === 0 ? undefined : 0.353
        expect(indexed.computeG(candidate, to, maximum, distance)).toBe(native.computeG(candidate, to, maximum, distance))
      }
    }
    expect(indexed.stats).toEqual(native.stats)
    expect(indexed.MAX_ITERATIONS).toBe(native.MAX_ITERATIONS)
  }
  expect(diagnostics.crossingIndexInstalledSolvers).toBe(8)
  expect(diagnostics.crossingIndexQueries).toBeGreaterThan(0)
  expect(diagnostics.crossingIndexWordQueries).toBeGreaterThan(0)
})
