import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { redistributePortPointsAroundFixedCopper } from "lib/solvers/UniformPortDistributionSolver/redistributePortPointsAroundFixedCopper"
import type {
  PortPointWithOwnerPair,
  SharedEdge,
} from "lib/solvers/UniformPortDistributionSolver/types"

test("copper spacing keeps graph ordering and leaves fully occupied boundaries for regional repair", (): void => {
  const edge: SharedEdge = {
    ownerNodeIds: ["a", "b"],
    ownerPairKey: "a|b",
    orientation: "horizontal",
    x1: 0,
    x2: 1,
    y1: 0,
    y2: 0,
    center: { x: 0.5, y: 0 },
    length: 1,
    nodeSideByOwnerId: { a: "top", b: "bottom" },
  }
  const connMap = new ConnectivityMap({})
  connMap.addConnections([["signal"], ["peer"], ["foreign"]])
  const original: PortPointWithOwnerPair = {
    portPointId: "crossing",
    connectionName: "signal",
    x: 0.5,
    y: 0,
    z: 0,
    ownerNodeIds: edge.ownerNodeIds,
    ownerPairKey: edge.ownerPairKey,
  }
  const peer = { ...original, portPointId: "peer", connectionName: "peer" }
  const constraints = {
    routes: [
      {
        connectionName: "foreign",
        traceThickness: 0.1,
        viaDiameter: 0.45,
        route: [
          { x: 0.78, y: -1, z: 0 },
          { x: 0.78, y: 1, z: 0 },
        ],
        vias: [],
      },
    ],
    connMap,
    layerCount: 2,
    traceWidth: 0.1,
    clearance: 0.15,
  }
  const result = redistributePortPointsAroundFixedCopper({
    sharedEdge: edge,
    portPoints: [
      { ...peer, x: 0.25 },
      { ...original, x: 0.75 },
    ],
    originalPortPoints: [{ ...peer, x: 0.1 }, original],
    constraints,
  })
  // The uniform slots would reserve x >= 0.625 for signal, entirely blocked.
  // Its original slot still admits a clear crossing above its peer.
  expect(result[1]!.x).toBeGreaterThan(result[0]!.x + 0.25)
  expect(result[1]!.x).toBeLessThan(0.53)
  const occupied = redistributePortPointsAroundFixedCopper({
    sharedEdge: edge,
    portPoints: [{ ...original, x: 0.75 }],
    originalPortPoints: [original],
    constraints: {
      ...constraints,
      routes: [{ ...constraints.routes[0]!, traceThickness: 2 }],
    },
  })
  expect(occupied).toEqual([original])
  expect(original.x).toBe(0.5)
})
