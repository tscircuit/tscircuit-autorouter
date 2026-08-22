import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { normalizeSrjRoutingLayers } from "lib/utils/routing-layer-constraints"

test("connection points must expose at least one allowed routing layer", () => {
  const baseSrj = {
    layerCount: 4,
    routingLayers: ["top", "bottom"],
    minTraceWidth: 0.15,
    obstacles: [],
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
  } satisfies Omit<SimpleRouteJson, "connections">

  expect(() =>
    normalizeSrjRoutingLayers({
      ...baseSrj,
      connections: [
        {
          name: "excluded-terminal",
          pointsToConnect: [{ x: 0, y: 0, layer: "inner1" }],
        },
      ],
    }),
  ).toThrow(
    'Connection "excluded-terminal" point 0 is on excluded routing layer "inner1"',
  )

  expect(() =>
    normalizeSrjRoutingLayers({
      ...baseSrj,
      connections: [
        {
          name: "excluded-terminal-via",
          pointsToConnect: [
            {
              x: 0,
              y: 0,
              layer: "top",
              terminalVia: { toLayer: "inner1" },
            },
          ],
        },
      ],
    }),
  ).toThrow(
    'Connection "excluded-terminal-via" point 0 terminal via ends on excluded routing layer "inner1"',
  )

  const normalized = normalizeSrjRoutingLayers({
    ...baseSrj,
    connections: [
      {
        name: "multilayer-terminal",
        pointsToConnect: [
          { x: 0, y: 0, layers: ["inner1", "bottom"] },
        ],
      },
    ],
  })
  expect(normalized.connections[0]?.pointsToConnect[0]).toMatchObject({
    layers: ["bottom"],
  })
})
