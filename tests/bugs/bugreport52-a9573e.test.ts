import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport52-a9573e/bugreport52-a9573e.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson
type Obstacle = SimpleRouteJson["obstacles"][number]

const pointInsideNode = (
  point: { x: number; y: number },
  node: NodeWithPortPoints,
) =>
  Math.abs(point.x - node.center.x) <= node.width / 2 + 1e-6 &&
  Math.abs(point.y - node.center.y) <= node.height / 2 + 1e-6

const pointInsideObstacle = (
  point: { x: number; y: number },
  obstacle: Obstacle,
) =>
  Math.abs(point.x - obstacle.center.x) <= obstacle.width / 2 + 1e-6 &&
  Math.abs(point.y - obstacle.center.y) <= obstacle.height / 2 + 1e-6

const getObstacleLabel = (obstacle: Obstacle) =>
  obstacle.obstacleId ??
  `${obstacle.type}@${obstacle.center.x.toFixed(3)},${obstacle.center.y.toFixed(3)}`

test("bugreport52-a9573e.json avoids a via inside multilayer pad cmn_184", () => {
  const solver = new AutoroutingPipelineSolver(srj, { cacheProvider: null })
  solver.solve()

  //expect(solver.solved).toBe(true)
  //expect(solver.failed).toBe(false)

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
}, 120_000)
