import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 routes all sections of an inline four-pad differential pair", () => {
  const traceWidth = 0.15
  const traceGap = 0.25
  const lengthTolerance = 0.05
  const connections = ["D_P", "D_N"].map((name, memberIndex) => ({
    name,
    path: [0, 1, 2, 3].map((padIndex) => `${name}_${padIndex}`),
    pointsToConnect: [-6, -2, 2, 6].map((x, padIndex) => ({
      x,
      y: memberIndex * (traceWidth + traceGap),
      layer: "top",
      pointId: `${name}_${padIndex}`,
    })),
  }))
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: traceWidth,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -9, maxX: 9, minY: -3, maxY: 3 },
    obstacles: [],
    connections,
    differentialPairs: [
      { connectionNames: ["D_P", "D_N"], traceGap, lengthTolerance },
    ],
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input)
  solver.solve()

  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  const routes = solver._getOutputHdRoutes()
  expect(routes).toHaveLength(6)

  const memberLengths = connections.map(({ name, pointsToConnect }) => {
    const sections = routes.filter((route) => route.rootConnectionName === name)
    expect(sections).toHaveLength(3)
    return pointsToConnect.slice(1).reduce((length, to, index) => {
      const from = pointsToConnect[index]!
      const section = sections.find(({ route }) => {
        const endpoints = [route[0]!, route.at(-1)!]
        return [from, to].every((pad) =>
          endpoints.some((point) => point.x === pad.x && point.y === pad.y),
        )
      })
      expect(section).toBeDefined()
      for (const point of section!.route) {
        expect(point.y).toBeCloseTo(from.y, 6)
        expect(point.z).toBe(0)
      }
      return section!.route.slice(1).reduce((total, point, pointIndex) => {
        const previous = section!.route[pointIndex]!
        return total + Math.hypot(point.x - previous.x, point.y - previous.y)
      }, length)
    }, 0)
  })
  expect(Math.abs(memberLengths[0]! - memberLengths[1]!)).toBeLessThanOrEqual(
    lengthTolerance,
  )
})
