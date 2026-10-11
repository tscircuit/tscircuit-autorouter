import { expect, test } from "bun:test"
import { TinyHyperGraphSolver, type Candidate, type TinyHyperGraphProblem, type TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"
import { computeRegionCost } from "tiny-hypergraph/lib/computeRegionCost"
import { TinyRegionScoringKernel } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/pathingWasm/TinyRegionScoringKernel"
import { regionScoringKernelBytes } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/pathingWasm/regionScoringKernelBytes"

test("pure strict region scoring matches native G, intersection geometry and IEEE boundary costs", (): void => {
  let seed = 0x51a792d
  const random = (): number => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0 }
  const portCount = 48, regionCount = 3
  const topology: TinyHyperGraphTopology = {
    portCount, regionCount,
    incidentPortRegion: Array.from({ length: portCount }, (_, port) => port % 3 === 0 ? [1, 0] : port % 3 === 1 ? [0, 2] : [2]),
    regionIncidentPorts: Array.from({ length: regionCount }, (_, region) => Array.from({ length: portCount }, (_, port) => port).filter((port) => port % 3 === 0 ? region < 2 : port % 3 === 1 ? region !== 1 : region === 2)),
    portX: new Float64Array(portCount), portY: new Float64Array(portCount), portZ: new Int32Array(portCount),
    portAngleForRegion1: new Int32Array(portCount), portAngleForRegion2: new Int32Array(portCount),
    regionWidth: new Float64Array(regionCount).fill(3), regionHeight: new Float64Array(regionCount).fill(4),
    regionCenterX: new Float64Array(regionCount), regionCenterY: new Float64Array(regionCount),
    regionAvailableZMask: new Int32Array(regionCount),
  }
  for (let port = 0; port < portCount; port++) {
    topology.portAngleForRegion1[port] = (random() % 40000) - 20000
    topology.portAngleForRegion2![port] = (random() % 40000) - 20000
    topology.portZ[port] = port % 7 === 0 ? -2147483648 : port % 7 === 1 ? 2147483647 : (random() % 40) - 4
  }
  const problem: TinyHyperGraphProblem = { routeCount: 1, routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([1]), routeNet: new Int32Array([3]), regionNetId: new Int32Array(regionCount).fill(-1),
    portSectionMask: new Int8Array(portCount).fill(1), portPenalty: new Float64Array(portCount) }
  for (let port = 0; port < portCount; port++) problem.portPenalty![port] = port % 11 === 0 ? -0 : (random() % 1000) / 500
  const native: any = new TinyHyperGraphSolver(topology, problem, { STATIC_REACHABILITY_PRECHECK: false })
  native.ADD_SEGMENT_DISTANCE_TO_G = true
  const makeKernel = (): TinyRegionScoringKernel => new TinyRegionScoringKernel({
    firstRegion: native.candidateFirstRegionByPortId, secondRegion: native.candidateSecondRegionByPortId,
    angle1: topology.portAngleForRegion1, angle2: topology.portAngleForRegion2, z: topology.portZ, penalty: problem.portPenalty,
  }, portCount, 64)
  let kernel = makeKernel()
  const neighbors = Int32Array.from({ length: portCount }, (_, index) => index)
  const distances = new Float64Array(portCount), maximumCosts = new Float64Array(portCount)
  const edgeNumbers = [0, -0, Number.MIN_VALUE, 2 ** -511, 1e-200, 1e-9, 0.3, 1, -1, 1e154, 1e308,
    Number.MAX_VALUE, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN]
  const masks = [0, 1, 2, 3, 4, 5, 8, 255, -1, -2147483648, 2147483647]
  let bounded = 0, impossible = 0, geometry = 0, costVisited = 0, finite = 0
  for (let iteration = 0; iteration < 1600; iteration++) {
    const region = iteration % regionCount, source = iteration % portCount, net = iteration % 7 - 3
    const existing = iteration % 23, length = existing === 0 ? iteration % 4 : existing
    const choose = (): number => iteration % 3 !== 0 ? (random() % 10000) / 1000 - 2 : edgeNumbers[random() % edgeNumbers.length]!
    const cache = {
      netIds: Int32Array.from({ length }, () => (random() % 7) - 3),
      lesserAngles: Int32Array.from({ length }, () => (random() % 40000) - 20000),
      greaterAngles: Int32Array.from({ length }, () => (random() % 40000) - 20000),
      layerMasks: Int32Array.from({ length }, () => masks[random() % masks.length]!),
      existingSameLayerIntersections: choose(), existingCrossingLayerIntersections: choose(),
      existingEntryExitLayerChanges: choose(), existingSegmentCount: existing,
      existingRegionCost: choose(),
    }
    const candidate: Candidate = { portId: source, nextRegionId: region, g: choose(), h: 0, f: 0 }
    const congestion = choose(), scale = choose(), width = choose(), height = choose(), pad = choose(), density = choose()
    const mask = masks[random() % masks.length]!
    native.state.currentRouteNetId = net
    native.state.regionIntersectionCaches[region] = cache
    native.state.regionCongestionCost[region] = congestion
    native.DISTANCE_TO_COST = scale; native.minViaPadDiameter = pad; native.TRACE_DENSITY_COST_FACTOR = density
    topology.regionWidth[region] = width; topology.regionHeight[region] = height; topology.regionAvailableZMask![region] = mask
    // The topology snapshot includes angles/layers, not these per-batch scalar
    // region dimensions or policies. Rebuild only for an explicit angle change.
    if (iteration === 800) { topology.portAngleForRegion1[0] = -2147483648; kernel = makeKernel() }
    for (let row = 0; row < portCount; row++) {
      distances[row] = choose()
      const lower = candidate.g + congestion + problem.portPenalty![row]! + distances[row]! * scale
      maximumCosts[row] = row % 5 === 0 ? lower : row % 5 === 1 ? lower - 1e-9 : row % 5 === 2 ? lower - 2e-9 : choose()
    }
    const result = kernel.score({ region, sourcePort: source, currentNet: net, neighbors, distances, maximumCosts,
      candidateG: candidate.g, congestion, distanceScale: scale, width, height, availableLayers: mask,
      padDiameter: pad, densityFactor: density, cache })
    expect(result.count).toBe(portCount)
    for (let row = 0; row < result.count; row++) {
      const scratchBefore = { ...native.segmentGeometryScratch }
      const expected = native.computeG(candidate, neighbors[row]!, maximumCosts[row]!, distances[row]!)
      expect(Object.is(result.g[row], expected)).toBe(true)
      if (Number.isFinite(expected)) finite++
      const flags = result.flags[row]!
      if (flags & 1) {
        geometry++
        expect(native.segmentGeometryScratch).toEqual({ netId: net, lesserAngle: result.lesser[row], greaterAngle: result.greater[row],
          layerMask: result.layers[row], entryExitLayerChanges: result.changes[row],
          sameLayerIntersectionCount: result.same[row], crossingLayerIntersectionCount: result.cross[row] })
      } else expect(native.segmentGeometryScratch).toEqual(scratchBefore)
      if (flags & 2) {
        costVisited++
        const cost = computeRegionCost(width, height, cache.existingSameLayerIntersections + result.same[row]!,
          cache.existingCrossingLayerIntersections + result.cross[row]!, cache.existingEntryExitLayerChanges + result.changes[row]!,
          cache.existingSegmentCount + 1, mask, pad, density)
        expect(Object.is(result.regionCost[row], cost)).toBe(true)
      } else if (flags & 1) impossible++
      else bounded++
    }
  }
  expect(geometry).toBeGreaterThan(10000)
  expect(costVisited).toBeGreaterThan(10000)
  expect(bounded).toBeGreaterThan(1000)
  expect(impossible).toBeGreaterThan(100)
  expect(finite).toBeGreaterThan(1000)
  expect(WebAssembly.Module.imports(new WebAssembly.Module(regionScoringKernelBytes))).toEqual([])
  expect(() => new TinyRegionScoringKernel({ firstRegion: new Int32Array(0), secondRegion: new Int32Array(0),
    angle1: new Int32Array(0), z: new Int32Array(0) }, 10_000_000, 0)).toThrow("resource bound")
  expect(() => kernel.score({ region: 0, sourcePort: -1, currentNet: 0, neighbors, distances, maximumCosts,
    candidateG: 0, congestion: 0, distanceScale: 0.05, width: 1, height: 1, availableLayers: 0,
    padDiameter: 0.3, densityFactor: 0, cache: native.state.regionIntersectionCaches[0] })).toThrow("numeric layout")
})
