import { expect, test } from "bun:test"
import { computeRegionCost } from "tiny-hypergraph/lib/computeRegionCost"
import { countNewIntersectionsWithValues } from "tiny-hypergraph/lib/countNewIntersections"
import {
  createPlanarSeedFixture,
  createPlanarSeedTestSolver,
} from "../fixtures/tinyhypergraph-planar-seed"

test("planar seeding rejects cheap layer transitions and disjoint-layer foreign crossings", (): void => {
  const transition = createPlanarSeedFixture()
  for (const segment of transition.segments) {
    if (segment.connectionId !== "upper-route") continue
    if (segment.fromPortId === "boundary-bottom") segment.fromPortId = "boundary-other-layer"
    if (segment.toPortId === "boundary-bottom") segment.toPortId = "boundary-other-layer"
  }
  const transitionSolver = createPlanarSeedTestSolver(transition.graph)
  transitionSolver.RIP_THRESHOLD_START = 0.8
  const transitionRegionId = transitionSolver.topology.regionMetadata!.findIndex(({ serializedRegionId }) => serializedRegionId === "left")
  const transitionCost = computeRegionCost(
    transitionSolver.topology.regionWidth[transitionRegionId]!,
    transitionSolver.topology.regionHeight[transitionRegionId]!,
    0, 0, 1, 1,
    transitionSolver.topology.regionAvailableZMask![transitionRegionId]!,
    transitionSolver.minViaPadDiameter,
    transitionSolver.TRACE_DENSITY_COST_FACTOR,
  )
  expect(transitionCost).toBeGreaterThan(0)
  expect(transitionCost).toBeLessThan(transitionSolver.RIP_THRESHOLD_START)
  const transitionStats = transitionSolver.initializePlanarSeed(transition.segments)
  expect(transitionStats.initialColdSeedEstimatedVias).toBe(0)
  expect(transitionStats.initialColdSeedRouteCount).toBe(1)
  expect(transitionSolver.state.unroutedRoutes).toEqual([0])
  expect(transitionSolver.state.regionSegments.flat().filter(([routeId]) => routeId === 0)).toEqual([])

  const crossing = createPlanarSeedFixture()
  for (const port of crossing.graph.ports) {
    if (port.portId === "lower-in" || port.portId === "lower-out") port.d!.z = 1
  }
  for (const segment of crossing.segments) {
    if (segment.connectionId !== "lower-route") continue
    if (segment.fromPortId === "boundary-top") segment.fromPortId = "boundary-other-layer"
    if (segment.toPortId === "boundary-top") segment.toPortId = "boundary-other-layer"
  }
  crossing.graph.regions.find(({ regionId }) => regionId === "left")!.assignments = [{ connectionId: "upper-route", regionPort1Id: "upper-in", regionPort2Id: "boundary-bottom" }]
  crossing.graph.regions.find(({ regionId }) => regionId === "right")!.assignments = [{ connectionId: "upper-route", regionPort1Id: "boundary-bottom", regionPort2Id: "upper-out" }]
  const crossingSolver = createPlanarSeedTestSolver(crossing.graph)
  crossingSolver.RIP_THRESHOLD_START = 0.8
  const { topology, state, problem } = crossingSolver
  const realOwners = new Int32Array(state.portAssignment)
  const realSegments = structuredClone(state.regionSegments)
  const realCaches = structuredClone(state.regionIntersectionCaches)
  for (const segment of crossing.segments.filter(({ connectionId }) => connectionId === "lower-route")) {
    const regionId = topology.regionMetadata!.findIndex(({ serializedRegionId }) => serializedRegionId === segment.regionId)
    const fromPortId = topology.portMetadata!.findIndex(({ serializedPortId }) => serializedPortId === segment.fromPortId)
    const toPortId = topology.portMetadata!.findIndex(({ serializedPortId }) => serializedPortId === segment.toPortId)
    const fromAngle = topology.incidentPortRegion[fromPortId]![0] === regionId ? topology.portAngleForRegion1[fromPortId]! : topology.portAngleForRegion2![fromPortId]!
    const toAngle = topology.incidentPortRegion[toPortId]![0] === regionId ? topology.portAngleForRegion1[toPortId]! : topology.portAngleForRegion2![toPortId]!
    expect(topology.portZ[fromPortId]).toBe(topology.portZ[toPortId])
    expect(countNewIntersectionsWithValues(state.regionIntersectionCaches[regionId]!, problem.routeNet[1]!, Math.min(fromAngle, toAngle), Math.max(fromAngle, toAngle), 1 << topology.portZ[fromPortId]!, 0)).toEqual([0, 1, 0])
    expect(computeRegionCost(topology.regionWidth[regionId]!, topology.regionHeight[regionId]!, 0, 1, 0, 2, topology.regionAvailableZMask![regionId]!, crossingSolver.minViaPadDiameter, crossingSolver.TRACE_DENSITY_COST_FACTOR)).toBeLessThan(crossingSolver.RIP_THRESHOLD_START)
  }
  const crossingStats = crossingSolver.initializePlanarSeed(crossing.segments)
  expect(crossingStats.initialColdSeedRouteCount).toBe(0)
  expect(crossingStats.initialColdSeedEstimatedVias).toBe(0)
  expect(state.unroutedRoutes).toEqual([1])
  expect(state.regionSegments).toEqual(realSegments)
  expect(state.portAssignment).toEqual(realOwners)
  expect(state.regionIntersectionCaches).toEqual(realCaches)
})
