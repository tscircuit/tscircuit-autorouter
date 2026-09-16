import { expect, test } from "bun:test"
import { sample002 } from "dataset-srj18"

test("SRJ18 sample002 includes the J4 pin 1 plated-slot obstacle", () => {
  const j4Pin1Obstacle = sample002.obstacles.find(
    (obstacle) => obstacle.connectedTo[0] === "pcb_plated_hole_58",
  )

  expect(j4Pin1Obstacle).toBeDefined()
  expect(j4Pin1Obstacle?.layers).toEqual(["top", "bottom"])
  expect(j4Pin1Obstacle?.center).toEqual({ x: -39.2404, y: -18.2722 })
  expect(j4Pin1Obstacle?.width).toBe(2)
  expect(j4Pin1Obstacle?.height).toBe(4.5)
})
