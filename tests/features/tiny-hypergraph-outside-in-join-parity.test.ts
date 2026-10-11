import { expect, test } from "bun:test"
import {
  OutsideInPartialRipTinyHyperGraphSolver,
  type Candidate,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "tiny-hypergraph/lib/index"

type OutsideInCandidate = Candidate & { travelDistance: number }
type JoinedCandidate = { candidate: Candidate; cost: number }
type JoinInternals = {
  getCandidatePath(candidate: OutsideInCandidate): OutsideInCandidate[]
  buildJoinedCandidate(
    forward: OutsideInCandidate,
    reverse: OutsideInCandidate,
    maximumCost?: number,
  ): JoinedCandidate | undefined
}

class JoinParitySolver extends OutsideInPartialRipTinyHyperGraphSolver {
  prepare(): boolean {
    const regionCosts = new Float64Array(this.topology.regionCount)
    regionCosts[2] = 1
    return this.preparePartialRip([2], regionCosts)
  }
}

// Original buildJoinedCandidate from tiny-hypergraph 474f522, with its two
// connector evaluations and eager path allocation retained as a reference.
function legacyBuildJoinedCandidate(
  this: JoinParitySolver,
  forward: OutsideInCandidate,
  reverse: OutsideInCandidate,
): JoinedCandidate | undefined {
  const internals = this as unknown as JoinInternals
  const forwardPath = internals.getCandidatePath(forward)
  const reversePath = internals.getCandidatePath(reverse)
  const portIds = forwardPath.map(({ portId }) => portId)
  const regionIds = forwardPath
    .slice(0, -1)
    .map(({ nextRegionId }) => nextRegionId)
  if (forward.portId !== reverse.portId) {
    if (forward.nextRegionId !== reverse.nextRegionId) return undefined
    const dx =
      this.topology.portX[forward.portId]! -
      this.topology.portX[reverse.portId]!
    const dy =
      this.topology.portY[forward.portId]! -
      this.topology.portY[reverse.portId]!
    const connectorDistance = Math.sqrt(dx * dx + dy * dy)
    if (
      forward.travelDistance + reverse.travelDistance + connectorDistance >
      this.OUTSIDE_IN_MAX_DISTANCE * 2
    )
      return undefined
    const connectorG = this.computeG(forward, reverse.portId)
    if (!Number.isFinite(connectorG)) return undefined
    regionIds.push(forward.nextRegionId)
    portIds.push(reverse.portId)
  }
  for (let index = reversePath.length - 2; index >= 0; index--) {
    regionIds.push(reversePath[index]!.nextRegionId)
    portIds.push(reversePath[index]!.portId)
  }
  if (
    new Set(portIds).size !== portIds.length ||
    regionIds.length + 1 !== portIds.length
  )
    return undefined
  let joined: Candidate = {
    portId: portIds[0]!,
    nextRegionId: regionIds[0]!,
    f: 0,
    g: 0,
    h: 0,
  }
  for (let index = 1; index < portIds.length; index++) {
    joined = {
      portId: portIds[index]!,
      prevRegionId: regionIds[index - 1]!,
      nextRegionId: regionIds[index] ?? regionIds[index - 1]!,
      prevCandidate: joined,
      f: 0,
      g: 0,
      h: 0,
    }
  }
  const connectorCost =
    forward.portId === reverse.portId
      ? 0
      : this.computeG(forward, reverse.portId) - forward.g
  return { candidate: joined, cost: forward.g + reverse.g + connectorCost }
}

function createSolver(distanceLimit: number): JoinParitySolver {
  const portCount = 10
  const topology: TinyHyperGraphTopology = {
    portCount,
    regionCount: 5,
    regionIncidentPorts: [
      [0],
      [0, 1, 2, 3, 4],
      [1, 2, 3, 4, 5, 6, 7, 8],
      [5, 6, 7, 8, 9],
      [9],
    ],
    incidentPortRegion: [
      [1, 0],
      ...Array.from({ length: 4 }, (): number[] => [1, 2]),
      ...Array.from({ length: 4 }, (): number[] => [2, 3]),
      [3, 4],
    ],
    regionWidth: new Float64Array(5).fill(4),
    regionHeight: new Float64Array(5).fill(3),
    regionCenterX: new Float64Array([-1, 1, 3, 5, 7]),
    regionCenterY: new Float64Array(5),
    regionAvailableZMask: new Int32Array(5).fill(3),
    portAngleForRegion1: new Int32Array([
      18000, 3000, 6000, 9000, 12000, 3000, 6000, 9000, 12000, 0,
    ]),
    portAngleForRegion2: new Int32Array([
      0, 21000, 24000, 27000, 30000, 21000, 24000, 27000, 30000, 18000,
    ]),
    portX: new Float64Array([0, 2, 2, 2, 2, 4, 4, 4, 4, 6]),
    portY: new Float64Array([0, -0.5, 0, 0.5, 1, -0.5, 0, 0.5, 1, 0]),
    portZ: new Int32Array(portCount),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array(portCount).fill(1),
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([9]),
    routeNet: new Int32Array([0]),
    regionNetId: new Int32Array(5).fill(-1),
  }
  const solver = new JoinParitySolver(topology, problem, {
    PARTIAL_RIP_MAX_DISTANCE: 6,
    PARTIAL_RIP_QUALITY_MAX_DISTANCE: 6,
    PARTIAL_RIP_MAX_ATTEMPTS: 1,
    OUTSIDE_IN_MAX_DISTANCE: distanceLimit,
    STATIC_REACHABILITY_PRECHECK: false,
  })
  solver.state.portAssignment.fill(0)
  solver.state.unroutedRoutes = []
  solver.state.regionSegments[1] = [[0, 0, 1]]
  solver.state.regionSegments[2] = [[0, 1, 5]]
  solver.state.regionSegments[3] = [[0, 5, 9]]
  return solver
}

test("outside-in joins preserve exact costs and routes while avoiding dominated path allocation", (): void => {
  for (const distanceLimit of [24, 0.5]) {
    const optimized = createSolver(distanceLimit)
    const legacy = createSolver(distanceLimit)
    const optimizedInternals = optimized as unknown as JoinInternals
    const legacyInternals = legacy as unknown as JoinInternals
    legacyInternals.buildJoinedCandidate =
      legacyBuildJoinedCandidate.bind(legacy)
    let optimizedPathBuilds = 0
    let legacyPathBuilds = 0
    const optimizedGetPath = optimizedInternals.getCandidatePath.bind(optimized)
    const legacyGetPath = legacyInternals.getCandidatePath.bind(legacy)
    optimizedInternals.getCandidatePath = (candidate): OutsideInCandidate[] => {
      optimizedPathBuilds++
      return optimizedGetPath(candidate)
    }
    legacyInternals.getCandidatePath = (candidate): OutsideInCandidate[] => {
      legacyPathBuilds++
      return legacyGetPath(candidate)
    }
    expect(optimized.prepare()).toBeTrue()
    expect(legacy.prepare()).toBeTrue()
    optimized.solve()
    legacy.solve()
    expect(optimized.solved).toBeTrue()
    expect(optimized.failed).toBeFalse()
    expect(optimized.getOutput()).toEqual(legacy.getOutput())
    expect(optimized.iterations).toBe(legacy.iterations)
    expect(optimized.stats).toEqual(legacy.stats)
    expect(optimized.state.regionSegments).toEqual(legacy.state.regionSegments)
    expect(optimized.state.regionIntersectionCaches).toEqual(
      legacy.state.regionIntersectionCaches,
    )
    expect(optimized.state.portAssignment).toEqual(legacy.state.portAssignment)
    if (distanceLimit === 24) {
      expect(optimized.stats.outsideInCompletedRouteCount).toBe(1)
      expect(optimized.stats.outsideInForwardExpansionCount).toBeGreaterThan(0)
      expect(optimized.stats.outsideInReverseExpansionCount).toBeGreaterThan(0)
      expect(optimizedPathBuilds).toBeLessThan(legacyPathBuilds)
    } else {
      expect(optimized.stats.outsideInFallbackRouteCount).toBe(1)
    }
  }

  const optimized = createSolver(24)
  const legacy = createSolver(24)
  const root: OutsideInCandidate = {
    portId: 0,
    nextRegionId: 1,
    g: 0,
    f: 0,
    h: 0,
    travelDistance: 0,
  }
  const end: OutsideInCandidate = {
    portId: 9,
    nextRegionId: 3,
    g: 0,
    f: 0,
    h: 0,
    travelDistance: 0,
  }
  const forward: OutsideInCandidate = {
    portId: 1,
    nextRegionId: 2,
    g: 0.375,
    f: 0,
    h: 0,
    travelDistance: 2,
    prevCandidate: root,
  }
  const reverse: OutsideInCandidate = {
    portId: 5,
    nextRegionId: 2,
    g: 0.125,
    f: 0,
    h: 0,
    travelDistance: 2,
    prevCandidate: end,
  }
  optimized.state.currentRouteNetId = legacy.state.currentRouteNetId = 0
  for (let index = 0; index < 24; index++) {
    optimized.TRACE_DENSITY_COST_FACTOR = legacy.TRACE_DENSITY_COST_FACTOR =
      (index % 3) / 5
    optimized.topology.portZ[5] = legacy.topology.portZ[5] = index % 2
    optimized.state.regionCongestionCost[2] =
      legacy.state.regionCongestionCost[2] = index / 32
    forward.g = index / 7
    reverse.g = index / 13
    const expected = legacyBuildJoinedCandidate.call(legacy, forward, reverse)!
    const internals = optimized as unknown as JoinInternals
    const actual = internals.buildJoinedCandidate(forward, reverse)!
    expect(actual.candidate).toEqual(expected.candidate)
    expect(Object.is(actual.cost, expected.cost)).toBeTrue()
    expect(
      internals.buildJoinedCandidate(forward, reverse, expected.cost),
    ).toBeUndefined()
    expect(
      internals.buildJoinedCandidate(forward, reverse, expected.cost + 1),
    ).toEqual(actual)
  }
})
