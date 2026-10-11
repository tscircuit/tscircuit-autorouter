import { expect, test } from "bun:test"
import { TinyBitsetHyperGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyBitsetHyperGraphSolver"
import { computeRegionCost } from "tiny-hypergraph/lib/computeRegionCost"
import {
  type Candidate,
  type TinyHyperGraphProblem,
  TinyHyperGraphSolver,
  type TinyHyperGraphTopology,
} from "tiny-hypergraph/lib/core"
import type { RegionIntersectionCache } from "tiny-hypergraph/lib/types"

class OriginalScoringSolver extends TinyHyperGraphSolver {
  constructor(topology: TinyHyperGraphTopology, problem: TinyHyperGraphProblem, addDistance: boolean) {
    super(topology, problem, {
      minViaPadDiameter: 0.37, DISTANCE_TO_COST: 0.17, TRACE_DENSITY_COST_FACTOR: 0.9,
    })
    this.ADD_SEGMENT_DISTANCE_TO_G = addDistance
  }
}

class BitsetScoringSolver extends TinyBitsetHyperGraphSolver {
  constructor(topology: TinyHyperGraphTopology, problem: TinyHyperGraphProblem, addDistance: boolean) {
    super(topology, problem, {
      minViaPadDiameter: 0.37, DISTANCE_TO_COST: 0.17, TRACE_DENSITY_COST_FACTOR: 0.9,
    })
    this.ADD_SEGMENT_DISTANCE_TO_G = addDistance
  }
}

const createTopology = (includeSecondAngles: boolean): TinyHyperGraphTopology => {
  const incidentPortRegion = [[0, 1], [1, 0], [2], [0, 1], [1, 0], [2, 0], [0, 0], [0, 1, 2]]
  return {
    portCount: 8, regionCount: 3, incidentPortRegion,
    regionIncidentPorts: [0, 1, 2].map((regionId) =>
      incidentPortRegion.flatMap((regions, portId) => regions.includes(regionId) ? [portId] : [])),
    regionWidth: new Float64Array([2.2, 4.1, 1.3]),
    regionHeight: new Float64Array([0.8, 3.7, 2.9]),
    regionCenterX: new Float64Array([0, 5, 10]),
    regionCenterY: new Float64Array([0, 2, -1]),
    regionAvailableZMask: new Int32Array([0, 1, 1 << 31]),
    portAngleForRegion1: new Int32Array([-9000, 18000, 9000, 36000, -18000, 0, 42, -36000]),
    ...(includeSecondAngles ? {
      portAngleForRegion2: new Int32Array([27000, -27000, 31500, 0, 18000, 36000, 999, 45000]),
    } : {}),
    portX: new Float64Array([0, 3.1, 5, -2, 1.25, 7, 2, -3]),
    portY: new Float64Array([0, 4.2, -1, 7, 8, 3, 2, 1]),
    portZ: new Int32Array([0, 0, 31, 1, 2, 31, 31, 0]),
  }
}

const createProblem = (includePenalty: boolean): TinyHyperGraphProblem => {
  return {
    routeCount: 1,
    portSectionMask: new Int8Array(8),
    routeStartPort: new Int32Array([0]), routeEndPort: new Int32Array([7]),
    routeNet: new Int32Array([17]), regionNetId: new Int32Array(3).fill(-1),
    ...(includePenalty ? { portPenalty: new Float64Array([0, 0.125, 0.1, 1e-10, 0.2, 0.3, 0.25, 10]) } : {}),
  }
}

const createRegionSnapshot = (
  topology: TinyHyperGraphTopology,
  regionId: number,
  segmentCount: number,
): RegionIntersectionCache => {
  const cache: RegionIntersectionCache = {
    netIds: new Int32Array(segmentCount),
    lesserAngles: new Int32Array(segmentCount),
    greaterAngles: new Int32Array(segmentCount),
    layerMasks: new Int32Array(segmentCount),
    existingSameLayerIntersections: 2,
    existingCrossingLayerIntersections: 3,
    existingEntryExitLayerChanges: 4,
    existingSegmentCount: segmentCount,
    existingRegionCost: computeRegionCost(
      topology.regionWidth[regionId]!, topology.regionHeight[regionId]!,
      2, 3, 4, segmentCount, topology.regionAvailableZMask![regionId]!, 0.37, 0.9,
    ),
  }
  const masks = [1, 2, 4, 1 << 31, -1, 0, 3]
  for (let i = 0; i < segmentCount; i++) {
    cache.netIds[i] = i % 3 === 0 ? 17 : i % 3 === 1 ? 5 : -2147483648
    cache.lesserAngles[i] = (i * 7919) % 72001 - 36000
    cache.greaterAngles[i] = cache.lesserAngles[i]! + 1000 + (i * 3571) % 18000
    cache.layerMasks[i] = masks[i % masks.length]!
  }
  return cache
}

test("tiny bitset candidate scoring preserves native angles, costs, pruning, and snapshot replacement", (): void => {
  for (const includeSecondAngles of [false, true]) {
    for (const addDistance of [false, true]) {
      for (const includePenalty of [false, true]) {
        const topology = createTopology(includeSecondAngles)
        const problem = createProblem(includePenalty)
        const original = new OriginalScoringSolver(topology, problem, addDistance)
        const bitset = new BitsetScoringSolver(topology, problem, addDistance)
        original.state.regionCongestionCost.set([0.25, 0.03125, 0.2])
        bitset.state.regionCongestionCost.set(original.state.regionCongestionCost)
        const snapshots = [0, 31, 32, 33].map((size) =>
          [0, 1, 2].map((regionId) => createRegionSnapshot(topology, regionId, size)))
        // Restore an older object after replacing every region's snapshot.
        for (const caches of [...snapshots, snapshots[1]!]) {
          original.state.regionIntersectionCaches = caches
          bitset.state.regionIntersectionCaches = caches
          for (const netId of [17, 5, -2147483648]) {
            original.state.currentRouteNetId = netId
            bitset.state.currentRouteNetId = netId
            for (let portId = 0; portId < topology.portCount; portId++) {
              for (let neighborPortId = 0; neighborPortId < topology.portCount; neighborPortId++) {
                for (let regionId = 0; regionId < topology.regionCount; regionId++) {
                  for (const g of [0.125, 1 / 3, 1e16]) {
                    const candidate: Candidate = { portId, nextRegionId: regionId, g, h: 0, f: g }
                    for (const knownSegmentDistance of [undefined, 0, 7.1234]) {
                      const dx = topology.portX[portId]! - topology.portX[neighborPortId]!
                      const dy = topology.portY[portId]! - topology.portY[neighborPortId]!
                      const segmentDistance = knownSegmentDistance ?? Math.sqrt(dx * dx + dy * dy)
                      const lowerBound = g + original.state.regionCongestionCost[regionId]! +
                        (problem.portPenalty?.[neighborPortId] ?? 0) + (addDistance ? segmentDistance * 0.17 : 0)
                      for (const maximumCost of [Infinity, lowerBound, lowerBound - 0.5e-9, lowerBound - 2e-9]) {
                        expect(bitset.computeG(candidate, neighborPortId, maximumCost, knownSegmentDistance))
                          .toBe(original.computeG(candidate, neighborPortId, maximumCost, knownSegmentDistance))
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  const topology = createTopology(true)
  const problem = createProblem(true)
  const original = new OriginalScoringSolver(topology, problem, false)
  const bitset = new BitsetScoringSolver(topology, problem, false)
  const crossing: RegionIntersectionCache = {
    netIds: new Int32Array([2]), lesserAngles: new Int32Array([-20000]),
    greaterAngles: new Int32Array([20000]), layerMasks: new Int32Array([1]),
    existingSameLayerIntersections: 0, existingCrossingLayerIntersections: 0,
    existingEntryExitLayerChanges: 0, existingSegmentCount: 1, existingRegionCost: 0,
  }
  for (const solver of [original, bitset]) {
    solver.state.currentRouteNetId = 17
    solver.state.regionIntersectionCaches = [crossing, crossing, crossing]
    solver.state.regionCongestionCost[0] = 0.25
  }
  const firstRegionCandidate: Candidate = { portId: 0, nextRegionId: 0, g: 0.5, h: 0, f: 0.5 }
  const expectedAngularCost = 0.5 + computeRegionCost(2.2, 0.8, 1, 0, 0, 2, 0, 0.37, 0.9) + 0.25 + 0.125
  expect(bitset.computeG(firstRegionCandidate, 1)).toBe(expectedAngularCost)
  expect(bitset.computeG(firstRegionCandidate, 1)).toBe(original.computeG(firstRegionCandidate, 1))
  expect(bitset.computeG(firstRegionCandidate, 1, 0.875 - 0.5e-9)).toBe(expectedAngularCost)
  expect(bitset.computeG(firstRegionCandidate, 1, 0.875 - 2e-9)).toBe(Infinity)

  // Region 1 is the second incident region of port 0; its distinct angle crosses.
  const singleLayerCandidate: Candidate = { portId: 0, nextRegionId: 1, g: 0, h: 0, f: 0 }
  expect(original.isKnownSingleLayerRegion(1)).toBe(true)
  expect(bitset.computeG(singleLayerCandidate, 1)).toBe(Infinity)
  expect(bitset.computeG(singleLayerCandidate, 1)).toBe(original.computeG(singleLayerCandidate, 1))
  // Preserve the source's positive-mask rule even for signed layer-31 masks.
  expect(original.isKnownSingleLayerRegion(2)).toBe(false)
  expect(bitset.isKnownSingleLayerRegion(2)).toBe(false)
})
