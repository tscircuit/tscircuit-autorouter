import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { serializePreloadedTraceAssignments } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/serializePreloadedTraceAssignments"

/**
 * A wire runs west to east: start pad, two free regions, a pad it passes
 * through, one more free region and its end pad. No connection touches the
 * pads, so the path planner drops them and every port on their edges. That
 * leaves the wire a single crossing, between the two free regions.
 */
const createLandingPadGraph = (isFixed: boolean): SerializedHyperGraph => {
  const regionIds = ["startPad", "freeA", "freeB", "midPad", "freeC", "endPad"]
  return {
    regions: regionIds.map((regionId, index) => ({
      regionId,
      pointIds: [],
      d: {
        center: { x: index, y: 0 },
        width: 1,
        height: 1,
        _containsObstacle: regionId.endsWith("Pad"),
      },
    })),
    ports: regionIds.slice(1).map((regionId, index) => ({
      portId: `${regionIds[index]}|${regionId}`,
      region1Id: regionIds[index]!,
      region2Id: regionId,
      d: {
        x: index + 0.5,
        y: 0,
        z: 0,
        _preloadedTracePortAssignments: [
          {
            traceId: "crystal",
            fixedNetId: "crystal-net",
            routePosition: index,
            tracePoint: { x: index + 0.5, y: 0 },
            z: 0,
            ...(isFixed && { isFixed: true }),
          },
        ],
      },
    })),
    connections: [],
    solvedRoutes: [],
  }
}

test("fixed copper left with one connected crossing stays in the path-planning graph", (): void => {
  const graph = createLandingPadGraph(true)
  const stats = serializePreloadedTraceAssignments(graph)

  // One run per stretch of free regions; each pad bounds a run.
  expect(
    graph.connections!.map((connection) => [
      connection.startRegionId,
      connection.endRegionId,
      "isFixed" in connection && connection.isFixed,
    ]),
  ).toEqual([
    ["startPad", "midPad", true],
    ["midPad", "endPad", true],
  ])
  const assignedPorts = Object.fromEntries(
    graph.regions.map((region) => [
      region.regionId,
      (region.assignments ?? []).map((assignment) => [
        assignment.regionPort1Id,
        assignment.regionPort2Id,
      ]),
    ]),
  )
  expect(assignedPorts).toEqual({
    startPad: [],
    freeA: [["startPad|freeA", "freeA|freeB"]],
    freeB: [["freeA|freeB", "freeB|midPad"]],
    midPad: [],
    freeC: [["midPad|freeC", "freeC|endPad"]],
    endPad: [],
  })
  expect(stats.preloadedAssignmentCount).toBe(3)

  // Movable copper keeps its existing treatment at unconnected pads.
  const movable = createLandingPadGraph(false)
  serializePreloadedTraceAssignments(movable)
  expect(
    movable.regions.map((region) => (region.assignments ?? []).length),
  ).toEqual([0, 0, 0, 0, 0, 0])
})
