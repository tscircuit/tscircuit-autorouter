import { expect, test } from "bun:test"
import { EscapeViaLocationSolver } from "../../../lib/solvers/EscapeViaLocationSolver/EscapeViaLocationSolver"
import type { Obstacle, SimpleRouteJson } from "../../../lib/types"

// A pad ringed by same-net spanning vias (the dense WSON-8 GND-cluster shape):
// previously every escape-via candidate around the pad was rejected because a
// same-net via sat in its path / clearance, so no escape via could be placed.
// hasClearEscapePath and getMinBlockingClearance now skip same-net obstacles,
// so the escape via still places. The skip only ever relaxes clearance for the
// via's own net, so it can never reject a candidate that was previously valid.
function srjWithRing(ring: Obstacle[]): SimpleRouteJson {
  return {
    layerCount: 4,
    minTraceWidth: 0.15,
    minViaDiameter: 0.3,
    defaultObstacleMargin: 0.15,
    bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 },
    obstacles: [
      {
        obstacleId: "pad",
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.6,
        height: 0.6,
        connectedTo: ["source_net_0", "pcb_port_a"],
      },
      {
        obstacleId: "pour",
        type: "rect",
        layers: ["inner1"],
        center: { x: 0, y: 0 },
        width: 7,
        height: 7,
        connectedTo: ["source_net_0"],
        isCopperPour: true,
      },
      ...ring,
    ],
    connections: [
      {
        name: "source_net_0",
        pointsToConnect: [
          {
            x: 0,
            y: 0,
            layer: "top",
            pointId: "pcb_port_a",
            pcb_port_id: "pcb_port_a",
          },
        ],
      },
    ],
  }
}

const escapePoints = (srj: SimpleRouteJson) => {
  const solver = new EscapeViaLocationSolver(srj)
  solver.solve()
  return (
    solver
      .getOutputSimpleRouteJson()
      .connections.find((connection) => connection.name === "source_net_0")
      ?.pointsToConnect.filter((point) =>
        point.pointId?.startsWith("escape-via:"),
      ) ?? []
  )
}

test("same-net spanning vias do not block escape-via placement", () => {
  const sameNetRing: Obstacle[] = [
    [0.55, 0],
    [-0.55, 0],
    [0, 0.55],
    [0, -0.55],
  ].map(([dx, dy]) => ({
    obstacleId: `via-${dx}-${dy}`,
    type: "rect",
    layers: ["top", "inner1"],
    zLayers: [0, 1],
    center: { x: dx, y: dy },
    width: 0.3,
    height: 0.3,
    connectedTo: ["source_net_0"],
  }))

  // Without the ring an escape via places; with a same-net ring it must still
  // place (the same-net vias are not clearance blockers for their own net).
  expect(escapePoints(srjWithRing([]))).toHaveLength(1)
  expect(escapePoints(srjWithRing(sameNetRing))).toHaveLength(1)
})

test("a foreign-net via ring still blocks escape-via placement", () => {
  // Same geometry, but the ring belongs to a different net. The skip is scoped
  // to the connection's own net, so these vias must still block — otherwise the
  // relaxation would be a blanket one and could place a via through foreign
  // copper.
  const foreignNetRing: Obstacle[] = [
    [0.55, 0],
    [-0.55, 0],
    [0, 0.55],
    [0, -0.55],
  ].map(([dx, dy]) => ({
    obstacleId: `foreign-via-${dx}-${dy}`,
    type: "rect",
    layers: ["top", "inner1"],
    zLayers: [0, 1],
    center: { x: dx, y: dy },
    width: 0.3,
    height: 0.3,
    connectedTo: ["source_net_other"],
  }))

  expect(escapePoints(srjWithRing(foreignNetRing))).toHaveLength(0)
})
