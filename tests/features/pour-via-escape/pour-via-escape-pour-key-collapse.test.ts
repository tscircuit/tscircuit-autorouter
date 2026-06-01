import { expect, test } from "bun:test"
import { EscapeViaLocationSolver } from "../../../lib/solvers/EscapeViaLocationSolver/EscapeViaLocationSolver"
import type { SimpleRouteJson } from "../../../lib/types"

// One logical inner1 pour rasterised into two ADJACENT cells (touching at x=0),
// with two pads — one over each cell. Each pad's escape via lands in a different
// cell. Keyed per raster cell (the old getObstacleKey) the two vias got different
// pour targets and were never grouped, so the MST routed a redundant pad-to-pad
// trace. Keyed by (layer, net) they share one target and group through
// externallyConnectedPointIds. The cells are contiguous on purpose — that is the
// topology (layer, net) keying assumes (see getPourKey).
function twoCellPourSrj(): SimpleRouteJson {
  return {
    layerCount: 4,
    minTraceWidth: 0.15,
    minViaDiameter: 0.3,
    defaultObstacleMargin: 0.15,
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
    obstacles: [
      {
        obstacleId: "pad-a",
        type: "rect",
        layers: ["top"],
        center: { x: -5, y: 0 },
        width: 1,
        height: 1,
        connectedTo: ["source_net_0", "pcb_port_a"],
      },
      {
        obstacleId: "pad-b",
        type: "rect",
        layers: ["top"],
        center: { x: 5, y: 0 },
        width: 1,
        height: 1,
        connectedTo: ["source_net_0", "pcb_port_b"],
      },
      {
        obstacleId: "pour-cell-left",
        type: "rect",
        layers: ["inner1"],
        center: { x: -4, y: 0 },
        width: 8,
        height: 8,
        connectedTo: ["source_net_0"],
        isCopperPour: true,
      },
      {
        obstacleId: "pour-cell-right",
        type: "rect",
        layers: ["inner1"],
        center: { x: 4, y: 0 },
        width: 8,
        height: 8,
        connectedTo: ["source_net_0"],
        isCopperPour: true,
      },
    ],
    connections: [
      {
        name: "source_net_0",
        pointsToConnect: [
          {
            x: -5,
            y: 0,
            layer: "top",
            pointId: "pcb_port_a",
            pcb_port_id: "pcb_port_a",
          },
          {
            x: 5,
            y: 0,
            layer: "top",
            pointId: "pcb_port_b",
            pcb_port_id: "pcb_port_b",
          },
        ],
      },
    ],
  }
}

test("escape vias landing in different cells of one pour group into one target", () => {
  const solver = new EscapeViaLocationSolver(twoCellPourSrj())
  solver.solve()

  const output = solver.getOutputSimpleRouteJson()
  const connection = output.connections.find(
    (candidate) => candidate.name === "source_net_0",
  )
  const escapePoints =
    connection?.pointsToConnect.filter((point) =>
      point.pointId?.startsWith("escape-via:"),
    ) ?? []
  expect(escapePoints).toHaveLength(2)

  // Both escape vias share the (layer, net) pour target, so they are grouped
  // into a single externallyConnectedPointIds group and the MST links them
  // through the pour instead of routing pad-to-pad.
  const metadataByPointId = solver.getEscapeViaMetadataByPointId()
  const targetPourKeys = new Set(
    escapePoints.map((point) =>
      point.pointId
        ? metadataByPointId.get(point.pointId)?.targetPourKey
        : null,
    ),
  )
  expect(targetPourKeys).toEqual(new Set(["inner1:source_net_0"]))

  expect(
    connection?.externallyConnectedPointIds?.some(
      (group) =>
        group.length === 2 &&
        group.every((pointId) => pointId.startsWith("escape-via:")),
    ),
  ).toBe(true)
})
