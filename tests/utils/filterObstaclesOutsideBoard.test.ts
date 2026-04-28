import { expect, test } from "bun:test"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import { filterObstaclesOutsideBoard } from "lib/utils/filterObstaclesOutsideBoard"

const createObstacle = (
  obstacle: Partial<Obstacle> & Pick<Obstacle, "center">,
): Obstacle => ({
  type: "rect",
  layers: ["top"],
  width: 1,
  height: 1,
  connectedTo: [],
  ...obstacle,
})

const createSrj = (obstacles: Obstacle[]): SimpleRouteJson => ({
  layerCount: 2,
  minTraceWidth: 0.2,
  bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
  outline: [
    { x: -5, y: -5 },
    { x: 5, y: -5 },
    { x: 5, y: 5 },
    { x: -5, y: 5 },
  ],
  connections: [],
  obstacles,
})

test("filters unconnected obstacles that are fully outside the board outline", () => {
  const srj = createSrj([
    createObstacle({ obstacleId: "inside", center: { x: 0, y: 0 } }),
    createObstacle({ obstacleId: "outside", center: { x: 8, y: 8 } }),
    createObstacle({
      obstacleId: "connected-outside",
      center: { x: 8, y: 8 },
      connectedTo: ["source_net_0"],
    }),
    createObstacle({
      obstacleId: "assignable-outside",
      center: { x: 8, y: 8 },
      netIsAssignable: true,
    }),
    createObstacle({
      obstacleId: "overlapping-edge",
      center: { x: 5.25, y: 0 },
    }),
  ])

  expect(
    filterObstaclesOutsideBoard(srj).obstacles.map(
      (obstacle) => obstacle.obstacleId,
    ),
  ).toEqual([
    "inside",
    "connected-outside",
    "assignable-outside",
    "overlapping-edge",
  ])
  expect(filterObstaclesOutsideBoard(srj).bounds).toMatchObject({
    minX: -5,
    maxX: 5,
    minY: -5,
    maxY: 5,
  })
})

test("falls back to bounds when no board outline is provided", () => {
  const srj = {
    ...createSrj([
      createObstacle({ obstacleId: "inside-bounds", center: { x: 0, y: 0 } }),
      createObstacle({
        obstacleId: "outside-bounds",
        center: { x: 11, y: 0 },
      }),
    ]),
    outline: undefined,
  }

  expect(
    filterObstaclesOutsideBoard(srj).obstacles.map(
      (obstacle) => obstacle.obstacleId,
    ),
  ).toEqual(["inside-bounds"])
})
