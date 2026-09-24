import { expect, test } from "bun:test"
import { partitionCoincidentPointPairConnections } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/partitionCoincidentPointPairConnections"
import type { SimpleRouteJson } from "lib/types"

test("coincident point pairs keep distinct identities and only bypass routing on a common layer", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -1, maxX: 2, minY: -1, maxY: 1 },
    obstacles: [],
    connections: [
      {
        name: "direct",
        nominalTraceWidth: 0.3,
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pointId: "a", pcb_port_id: "pcb_a" },
          {
            x: 0,
            y: 0,
            layers: ["bottom", "top"],
            pointId: "b",
            pcb_port_id: "pcb_b",
          },
        ],
      },
      {
        name: "needs-via",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pointId: "c" },
          { x: 0, y: 0, layer: "bottom", pointId: "d" },
        ],
      },
      {
        name: "needs-wire",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pointId: "e" },
          { x: 1, y: 0, layer: "top", pointId: "f" },
        ],
      },
      {
        name: "needs-terminal-via",
        pointsToConnect: [
          {
            x: 0,
            y: 0,
            layer: "top",
            pointId: "g",
            terminalVia: { toLayer: "bottom" },
          },
          { x: 0, y: 0, layer: "top", pointId: "h" },
        ],
      },
    ],
  }
  const before = structuredClone(srj)
  const { routingSrj, directHdRoutes } =
    partitionCoincidentPointPairConnections(srj, 0.6)
  expect(routingSrj.connections.map((connection) => connection.name)).toEqual([
    "needs-via",
    "needs-wire",
    "needs-terminal-via",
  ])
  expect(directHdRoutes).toEqual([
    {
      connectionName: "direct",
      rootConnectionName: "direct",
      startPcbPortId: "pcb_a",
      endPcbPortId: "pcb_b",
      traceThickness: 0.3,
      viaDiameter: 0.6,
      route: [
        { x: 0, y: 0, z: 0, pcb_port_id: "pcb_a" },
        { x: 0, y: 0, z: 0, pcb_port_id: "pcb_b" },
      ],
      vias: [],
    },
  ])
  expect(srj).toEqual(before)
  srj.buses = [
    {
      busId: "restricted",
      connectionNames: ["direct"],
      allowedLayers: ["bottom"],
    },
  ]
  expect(
    partitionCoincidentPointPairConnections(srj, 0.6).directHdRoutes,
  ).toEqual([])
})
