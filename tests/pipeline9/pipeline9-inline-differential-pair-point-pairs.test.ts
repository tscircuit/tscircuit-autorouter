import { expect, test } from "bun:test"
import { Pipeline9NetToPointPairsSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9NetToPointPairsSolver"
import type { SimpleRouteJson } from "lib/types"

test("retains declared inline sections while routing taps and escape vias", () => {
  const [positive, negative] = ["P", "N"].map((name, polarity) => ({
    name,
    path: ["A", "B", "C"].map((pad) => `${name}.${pad}`),
    pointsToConnect: [
      { x: 0, y: 0, pad: "A" },
      { x: 2, y: 0, pad: "C" },
      { x: 4, y: 4, pad: "B" },
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
      {
        ...positive!,
        pointsToConnect: [
          ...positive!.pointsToConnect,
          { x: 5, y: 5, pointId: "TP", layer: "top" },
        ],
      },
      negative!,
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
  expect(solver.newConnections.every((connection) => !connection.path)).toBe(true)

  const inputWithoutPath = structuredClone(input)
  delete inputWithoutPath.connections[0]!.path
  expect(
    () =>
      new Pipeline9NetToPointPairsSolver({
        srjBeforeEscapeVias: inputWithoutPath,
        srjWithEscapeVias: inputWithoutPath,
        colorMap: {},
      }),
  ).toThrow('Differential pair member "P" needs a path for its 4 points')
})
