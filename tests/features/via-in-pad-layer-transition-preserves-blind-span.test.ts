import { expect, test } from "bun:test"
import { getTargetLayerTransitionPoints } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/getTargetLayerTransitionPoints"
import type { SimpleRouteJson } from "lib/types"

test("via-in-pad escapes use only the contiguous clear layer span and share terminal sites", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    allowViaInPad: true,
    allowBlindAndBuriedVias: true,
    minTraceWidth: 0.15,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["port-a"],
      },
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 2,
        height: 2,
        layers: ["bottom"],
        connectedTo: ["foreign-net"],
      },
      ...[
        [0.5, 0],
        [-0.5, 0],
        [0, 0.5],
        [0, -0.5],
      ].map(([x, y]) => ({
        type: "rect" as const,
        center: { x: x!, y: y! },
        width: 0.2,
        height: 0.2,
        layers: ["top"],
        connectedTo: ["foreign-net"],
      })),
    ],
    connections: [0, 1].map((index) => ({
      name: `net-a_mst${index}`,
      __rootConnectionNames: ["net-a"],
      pointsToConnect: [
        { x: 0, y: 0, layer: "top", pcb_port_id: "port-a" },
        { x: 3, y: index, layer: "top", pcb_port_id: `port-b${index}` },
      ],
    })),
  }
  const points = getTargetLayerTransitionPoints({
    srj,
    viaDiameter: 0.2,
    obstacleMargin: 0.1,
  })
  const padSites = points.filter((point) => point.x === 0 && point.y === 0)
  expect(padSites).toHaveLength(1)
  expect(padSites[0]!.availableZ).toEqual([0, 1, 2])
  expect(
    getTargetLayerTransitionPoints({
      srj: { ...srj, allowBlindAndBuriedVias: false },
      viaDiameter: 0.2,
      obstacleMargin: 0.1,
    }).some((point) => point.x === 0 && point.y === 0),
  ).toBeFalse()
})
