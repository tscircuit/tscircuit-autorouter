import { expect, test } from "bun:test"
import type { Obstacle } from "lib/types"
import { mergeAnonymousObstacleRects } from "lib/utils/mergeAnonymousObstacleRects"

test("rectangle union preserves holes, notches and disconnected islands", () => {
  const occupied = [
    "111110011",
    "100010011",
    "100010000",
    "111110000",
    "001110000",
  ]
  const input: Obstacle[] = occupied.flatMap((row, y): Obstacle[] =>
    [...row].flatMap((cell, x): Obstacle[] =>
      cell === "1"
        ? [
            {
              type: "rect",
              layers: ["top"],
              connectedTo: [],
              center: { x: x + 0.5, y: y + 0.5 },
              width: 1,
              height: 1,
            },
          ]
        : [],
    ),
  )
  const result = mergeAnonymousObstacleRects(input)
  expect(result.length).toBeLessThan(input.length)
  for (let y = 0; y < occupied.length; y++) {
    for (let x = 0; x < occupied[y]!.length; x++) {
      const covered = result.some(
        (rect): boolean =>
          Math.abs(rect.center.x - (x + 0.5)) < rect.width / 2 &&
          Math.abs(rect.center.y - (y + 0.5)) < rect.height / 2,
      )
      expect(covered).toBe(occupied[y]![x] === "1")
    }
  }
})
