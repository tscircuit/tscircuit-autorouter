import { expect, test } from "bun:test"
import { applyDifferentialPairPaths } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyDifferentialPairPaths"
import { NetToPointPairsSolver2_OffBoardConnection } from "lib/solvers/NetToPointPairsSolver2_OffBoardConnection/NetToPointPairsSolver2_OffBoardConnection"
import type { SimpleRouteJson } from "lib/types"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"

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
  const solver = new NetToPointPairsSolver2_OffBoardConnection(
    srjWithEscapeVias,
    {},
    getInitiallyConnectedMapFromSimpleRouteJson(srjWithEscapeVias),
  )
  solver.solve()
  const pointPairSrj = solver.getNewSimpleRouteJson()
  const { srj, sectionNamesByMember } = applyDifferentialPairPaths({
    inputSrj: input,
    routingSrj: srjWithEscapeVias,
    pointPairSrj,
  })

  expect(
    solver.newConnections.some((connection) =>
      ["P.A", "P.C"].every((pad) =>
        connection.pointsToConnect.some((point) => point.pointId === pad),
      ),
    ),
  ).toBe(true)
  expect(
    sectionNamesByMember
      .get("P")!
      .map((name) =>
        srj.connections
          .find((connection) => connection.name === name)!
          .pointsToConnect.map((point) => point.pointId),
      ),
  ).toEqual([
    ["P.A", "P.B"],
    ["P.B", "P.C"],
  ])
  const routedLinks = srj.connections.map((connection) =>
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
  expect(srj.connections.every((connection) => !connection.path)).toBe(true)

  const inputWithoutPath = structuredClone(input)
  delete inputWithoutPath.connections[0]!.path
  expect(() =>
    applyDifferentialPairPaths({
      inputSrj: inputWithoutPath,
      routingSrj: srjWithEscapeVias,
      pointPairSrj,
    }),
  ).toThrow('Differential pair member "P" needs a path for its 4 points')
})
