import { expect, test } from "bun:test"
import { Pipeline9NetToPointPairsSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9NetToPointPairsSolver"
import type { SimpleRouteJson } from "lib/types"

test("retains declared inline sections while routing taps and escape vias", () => {
  const [positive, negative] = ["P", "N"].map((name, polarity) => ({
    name,
    pointsToConnect: [
      { x: 0, y: 0, pad: "A" },
      { x: 4, y: 4, pad: "B" },
      { x: 2, y: 0, pad: "C" },
    ].map(({ x, y, pad }) => ({
      x,
      y: y + polarity * 0.6,
      pointId: `${name}.${pad}`,
      layer: "top",
    })),
  }))
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -1, maxX: 7, minY: -1, maxY: 7 },
    obstacles: [],
    connections: [
      positive!,
      negative!,
      {
        name: "TEST_POINT",
        pointsToConnect: [
          positive!.pointsToConnect[1]!,
          { x: 5, y: 5, pointId: "TP", layer: "top" },
        ],
      },
    ],
    differentialPairs: [{ connectionNames: ["P", "N"], lengthTolerance: 0.05 }],
  }
  const srjWithEscapeVias = structuredClone(input)
  srjWithEscapeVias.connections[0]!.pointsToConnect.push({
    x: -0.5,
    y: 0,
    pointId: "P.escape",
    layer: "top",
    terminalVia: { toLayer: "bottom", viaDiameter: 0.5 },
  })
  const solver = new Pipeline9NetToPointPairsSolver({
    srjBeforeEscapeVias: input,
    srjWithEscapeVias,
    colorMap: {},
  })
  solver.solve()

  const routedLinks = solver.newConnections.map((connection) =>
    connection.pointsToConnect
      .map((point) => point.pointId)
      .sort()
      .join("/"),
  )
  expect(routedLinks.sort()).toEqual([
    "N.A/N.B",
    "N.B/N.C",
    "P.A/P.B",
    "P.A/P.escape",
    "P.B/P.C",
    "P.B/TP",
  ])
})
