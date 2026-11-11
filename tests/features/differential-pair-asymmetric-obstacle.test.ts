import { expect, test } from "bun:test"
import { distance } from "@tscircuit/math-utils"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("Pipeline9 tunes a path with unequal lanes and an obstacle on one side", () => {
  const lengthTolerance = 0.05
  const connections = ["P", "N"].map((name, lane) => {
    const pointsToConnect = [-8, 0, lane === 0 ? 6.7 : 8].map((x, index) => {
      const pointId = `pcb_port_${lane * 3 + index}`
      return { x, y: lane * 0.4, layer: "top", pointId, pcb_port_id: pointId }
    })
    return {
      name,
      path: pointsToConnect.map((point) => point.pointId),
      pointsToConnect,
    }
  })
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -10, maxX: 10, minY: -4, maxY: 4 },
    obstacles: [
      ...connections.flatMap(({ name, pointsToConnect }) =>
        pointsToConnect.map(
          ({ x, y, pointId }): Obstacle => ({
            type: "rect",
            layers: ["top"],
            center: { x, y },
            width: 0.2,
            height: 0.2,
            connectedTo: [name, pointId],
            circuitJsonMetadata: {
              pcb_port_id: pointId,
              pcb_smtpad_id: `pad_${pointId}`,
            },
          }),
        ),
      ),
      {
        obstacleId: "blocker",
        type: "rect",
        layers: ["top"],
        center: { x: -4, y: -0.3 },
        width: 1.8,
        height: 1,
        connectedTo: [],
      },
    ],
    connections,
    differentialPairs: [
      { connectionNames: ["P", "N"], traceGap: 0.25, lengthTolerance },
    ],
  }
  const getSkew = (hdRoutes: HighDensityRoute[]): number => {
    const [positiveLength, negativeLength] = ["P", "N"].map((name) =>
      hdRoutes
        .filter((route) => route.rootConnectionName === name)
        .reduce(
          (length, { route }) =>
            route.slice(1).reduce((total, point, index) => {
              const previous = route[index]!
              return total + distance(previous, point)
            }, length),
          0,
        ),
    )
    return Math.abs(positiveLength! - negativeLength!)
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input)
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(getSkew(solver.effortCleanupSolver!.getOutput())).toBeGreaterThan(
    lengthTolerance,
  )
  const { hdRoutes, postProcessingErrors } =
    solver.lengthMatchingPostProcessingSolver!.getOutput()
  expect(postProcessingErrors).toEqual([])
  expect(hdRoutes).toHaveLength(4)
  expect(getSkew(hdRoutes)).toBeLessThanOrEqual(lengthTolerance)
  expect(
    evaluateRelaxedDrc({
      inputSrj: input,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: solver.getOutputSimplifiedPcbTraces(),
    }).errors,
  ).toEqual([])
})
