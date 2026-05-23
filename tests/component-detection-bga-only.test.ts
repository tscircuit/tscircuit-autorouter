import { expect, test } from "bun:test"
import { ComponentDetectionSolver } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import type { Obstacle, SimpleRouteJson } from "lib/types"

const createPad = ({
  componentId,
  obstacleId,
  x,
  y,
}: {
  componentId: string
  obstacleId: string
  x: number
  y: number
}): Obstacle => ({
  obstacleId,
  componentId,
  type: "rect",
  layers: ["top"],
  center: { x, y },
  width: 0.2,
  height: 0.2,
  connectedTo: [],
})

const createSrj = (obstacles: Obstacle[]): SimpleRouteJson => ({
  layerCount: 2,
  minTraceWidth: 0.1,
  obstacles,
  connections: [],
  bounds: { minX: -2, maxX: 4, minY: -2, maxY: 4 },
})

test("component detection only creates regions for BGA-like components", () => {
  const passivePads = [
    createPad({ componentId: "R1", obstacleId: "R1.1", x: -1, y: 0 }),
    createPad({ componentId: "R1", obstacleId: "R1.2", x: 0, y: 0 }),
  ]
  const bgaPads = Array.from({ length: 9 }, (_, index) =>
    createPad({
      componentId: "U_BGA",
      obstacleId: `U_BGA.${index + 1}`,
      x: index % 3,
      y: Math.floor(index / 3),
    }),
  )
  const solver = new ComponentDetectionSolver({
    inputSrj: createSrj([...passivePads, ...bgaPads]),
  })

  solver.solve()

  const output = solver.getOutput()
  expect(output.components.map((component) => component.componentId)).toEqual([
    "U_BGA",
  ])
  expect(
    output.global.obstacles.some((obstacle) => obstacle.obstacleId === "R1.1"),
  ).toBe(true)
  expect(
    output.global.obstacles.some(
      (obstacle) => obstacle.obstacleId === "component-region:R1",
    ),
  ).toBe(false)
  expect(
    output.global.obstacles.some(
      (obstacle) => obstacle.obstacleId === "component-region:U_BGA",
    ),
  ).toBe(true)
})
