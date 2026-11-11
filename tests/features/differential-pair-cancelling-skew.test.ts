import { expect, test } from "bun:test"
import { distance } from "@tscircuit/math-utils"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 accepts cancelling section skews under the whole-path tolerance", () => {
  const lengthTolerance = 0.05
  const connections = ["P", "N"].map((name, lane) => ({
    name,
    path: ["A", "B", "C"].map((pad) => `${name}.${pad}`),
    pointsToConnect: [-5, lane === 0 ? 0.04 : 0, 5].map((x, index) => ({
      x,
      y: lane * 0.4,
      layer: "top",
      pointId: `${name}.${["A", "B", "C"][index]}`,
    })),
  }))
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -7, maxX: 7, minY: -3, maxY: 3 },
    obstacles: [],
    connections,
    differentialPairs: [
      { connectionNames: ["P", "N"], traceGap: 0.25, lengthTolerance },
    ],
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input)
  solver.solve()

  expect(solver.solved).toBe(true)
  const { hdRoutes, postProcessingErrors } =
    solver.lengthMatchingPostProcessingSolver!.getOutput()
  expect(postProcessingErrors).toEqual([])
  const skews = [0, 1].map((section) => {
    const [positiveLength, negativeLength] = connections.map(({ path }) => {
      const { name } = solver.srjWithPointPairs!.connections.find(
        ({ pointsToConnect }) =>
          pointsToConnect[0]?.pointId === path[section] &&
          pointsToConnect[1]?.pointId === path[section + 1],
      )!
      const { route } = hdRoutes.find((route) => route.connectionName === name)!
      return route.slice(1).reduce((length, point, index) => {
        const previous = route[index]!
        return length + distance(previous, point)
      }, 0)
    })
    return positiveLength! - negativeLength!
  })
  expect(skews[0]!).toBeGreaterThan(lengthTolerance / 2)
  expect(skews[1]!).toBeLessThan(-lengthTolerance / 2)
  expect(Math.abs(skews[0]! + skews[1]!)).toBeLessThanOrEqual(lengthTolerance)
})
