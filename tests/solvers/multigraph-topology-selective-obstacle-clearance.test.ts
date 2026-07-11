import { expect, test } from "bun:test"
import { MultiGraphTopologyPlannerSolver } from "lib/solvers/TopologyPlanningSolver/MultiGraphTopologyPlannerSolver"
import type { Obstacle, SimpleRouteJson } from "lib/types"

const replacementObstacle: Obstacle & { obstacleId: string } = {
  obstacleId: "component-bounds",
  componentId: "component-1",
  center: { x: 0, y: 0 },
  width: 2,
  height: 2,
  layers: ["top", "bottom"],
  connectedTo: [],
}

test("global topology leaves component-owned obstacles exact while expanding ordinary obstacles", (): void => {
  const overlappingObstacle: Obstacle = {
    obstacleId: "overlapping-pad",
    center: { x: 0.8, y: 0 },
    width: 0.5,
    height: 0.5,
    layers: ["top"],
    connectedTo: [],
  }
  const ordinaryObstacle: Obstacle = {
    obstacleId: "ordinary-pad",
    center: { x: 4, y: 0 },
    width: 0.5,
    height: 0.5,
    layers: ["top"],
    connectedTo: [],
  }
  const inputSrj: SimpleRouteJson = {
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    layerCount: 2,
    minTraceWidth: 0.15,
    obstacles: [replacementObstacle, overlappingObstacle, ordinaryObstacle],
    connections: [],
  }
  const solver = new MultiGraphTopologyPlannerSolver({
    inputSrj,
    globalNoConnectionSrj: inputSrj,
    obstacleMargin: 0.2,
    components: [
      {
        componentId: "component-1",
        componentKind: "bga",
        memberObstacleIds: [replacementObstacle.obstacleId],
        memberObstacles: [replacementObstacle],
        replacementObstacle,
      },
    ],
  })

  solver.step()

  const rectDiffInput = solver.globalTopologySolver!.inputProblem
  const obstacleById = new Map(
    rectDiffInput.simpleRouteJson.obstacles.map((obstacle) => [
      obstacle.obstacleId,
      obstacle,
    ]),
  )
  expect(rectDiffInput.obstacleClearance).toBe(0)
  expect(obstacleById.get("component-bounds")?.width).toBe(2)
  expect(obstacleById.get("overlapping-pad")?.width).toBe(0.5)
  expect(obstacleById.get("ordinary-pad")?.width).toBe(0.9)
})
