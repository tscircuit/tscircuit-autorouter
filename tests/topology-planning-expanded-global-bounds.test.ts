import { expect, test } from "bun:test"
import { getExpandedGlobalTopologySrj } from "lib/solvers/TopologyPlanningSolver/get-expanded-global-topology-srj"
import type { SimpleRouteJson } from "lib/types"

test("global topology bounds expand only around geometry outside declared bounds", () => {
  const inputSrj = {
    bounds: {
      minX: 0,
      maxX: 10,
      minY: 0,
      maxY: 10,
    },
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    obstacles: [
      {
        type: "rect",
        center: { x: -2, y: 5 },
        width: 2,
        height: 2,
        layers: ["top", "bottom"],
        connectedTo: [],
      },
      {
        type: "rect",
        center: { x: 1, y: 5 },
        width: 2,
        height: 2,
        layers: ["top"],
        connectedTo: [],
      },
    ],
    connections: [
      {
        name: "outside",
        pointsToConnect: [
          { x: 12, y: 5, layer: "top", pointId: "outside-port" },
        ],
      },
    ],
    traces: [],
  } as SimpleRouteJson

  const result = getExpandedGlobalTopologySrj({
    inputSrj,
    viaDiameter: 0.4,
    obstacleMargin: 0.1,
  })

  expect(result.bounds).toEqual({
    minX: -3.3,
    maxX: 12.3,
    minY: 0,
    maxY: 10,
  })
  expect(inputSrj.bounds).toEqual({
    minX: 0,
    maxX: 10,
    minY: 0,
    maxY: 10,
  })
})
