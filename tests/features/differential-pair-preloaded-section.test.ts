import { expect, test } from "bun:test"
import { distance } from "@tscircuit/math-utils"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("Pipeline9 preserves preloaded sections and matches length across the whole pair", () => {
  const lengthTolerance = 0.05
  const sharedName = "unrelated_route"
  const connections = ["P", "N"].map((name, lane) => ({
    name,
    path: ["A", "B", "C"].map((pad) => `${name}.${pad}`),
    pointsToConnect: [-6, 0, 6].map((x, index) => ({
      x,
      y: lane * 0.4,
      layer: "top",
      pointId: `${name}.${["A", "B", "C"][index]}`,
    })),
  }))
  const fixedTraces = [
    [
      { x: -6, y: 0 },
      { x: -5, y: -1 },
      { x: -1, y: -1 },
      { x: 0, y: 0 },
    ],
    [
      { x: -6, y: 0.4 },
      { x: 0, y: 0.4 },
    ],
  ].map(
    (points, lane): SimplifiedPcbTrace => ({
      type: "pcb_trace",
      pcb_trace_id: lane === 0 ? sharedName : "fixed_negative",
      connection_name: connections[lane]!.name,
      isFixed: true,
      connectsTo: connections[lane]!.path.slice(0, 2),
      route: points.map((point) => ({
        ...point,
        route_type: "wire",
        width: 0.15,
        layer: "top",
      })),
    }),
  )
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -8, maxX: 8, minY: -4, maxY: 4 },
    obstacles: [],
    connections: [
      ...connections,
      {
        name: sharedName,
        pointsToConnect: [
          { x: -7, y: 2.8, layer: "top", pointId: "U.A" },
          { x: -5.5, y: 2.8, layer: "top", pointId: "U.B" },
        ],
      },
    ],
    traces: fixedTraces,
    differentialPairs: [{ connectionNames: ["P", "N"], lengthTolerance }],
  }

  const originalFixedTraces = structuredClone(fixedTraces)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input)
  solver.solve()

  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  expect(solver.getOutputSimpleRouteJson().traces).toEqual(
    expect.arrayContaining(originalFixedTraces),
  )
  expect(
    solver
      .srjWithPointPairs!.connections.map((connection) =>
        connection.pointsToConnect.map((point) => point.pointId).join("/"),
      )
      .sort(),
  ).toEqual(["N.B/N.C", "P.B/P.C", "U.A/U.B"])
  const { hdRoutes, postProcessingErrors } =
    solver.lengthMatchingPostProcessingSolver!.getOutput()
  expect(postProcessingErrors).toEqual([])
  expect(hdRoutes).toHaveLength(3)
  expect(hdRoutes.some((route) => route.connectionName === sharedName)).toBe(
    true,
  )
  const [positiveLength, negativeLength] = ["P", "N"].map((name) => {
    const { route } = hdRoutes.find(
      (route) => route.rootConnectionName === name,
    )!
    return route.slice(1).reduce((length, point, index) => {
      const previous = route[index]!
      return length + distance(previous, point)
    }, 0)
  })
  const preloadedSkew = 2 * Math.SQRT2 + 4 - 6
  expect(negativeLength! - positiveLength!).toBeGreaterThan(0.5)
  expect(
    Math.abs(preloadedSkew + positiveLength! - negativeLength!),
  ).toBeLessThanOrEqual(lengthTolerance)
})
