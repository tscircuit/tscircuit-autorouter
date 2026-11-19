import { expect, test } from "bun:test"
import type { Obstacle } from "@tscircuit/capacity-autorouter"
import { distanceSegmentToObstacle } from "lib/geometry"
import { routeBus } from "lib/route-bus"
import { segmentIsClearOfObstacles } from "lib/route-bus/plan-static-clearance"
import type { RoutedSegment } from "lib/types"
import { createIcepiPlaneDrop } from "./fixtures/icepi-plane-drop"

function expectExactObstacleClearance(
  {
    segment,
    obstacle,
    clearance,
  }: { segment: RoutedSegment; obstacle: Obstacle; clearance: number },
  context: Pick<
    Parameters<typeof segmentIsClearOfObstacles>[0],
    "plan" | "srj"
  >,
): void {
  const expected =
    !obstacle.layers.includes(segment.layer) ||
    !(
      distanceSegmentToObstacle(segment, obstacle) <
      segment.width / 2 + clearance - 1e-9
    )
  expect(
    segmentIsClearOfObstacles({
      ...context,
      segment,
      obstacles: [obstacle],
      segmentIndex: -1,
      allowSameNetMerges: false,
      clearance,
    }),
    JSON.stringify({ segment, obstacle, clearance }),
  ).toBe(expected)
}

function* deterministicFractions(seed: number): Generator<number, never, void> {
  while (true) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    yield seed / 4294967296
  }
}

test("segment obstacle bounds retain exact rotated, circular and near-clearance decisions", (): void => {
  const params = createIcepiPlaneDrop()
  const plan = routeBus(params)?.[0]
  if (!plan) throw new Error("Native plane escape was rejected")
  const context = { plan, srj: params.srj }
  const segment: RoutedSegment = {
    start: { x: -1, y: 0 },
    end: { x: 1, y: 0 },
    width: 0.1,
    layer: "top",
  }
  for (const shape of [undefined, "circle"] as const) {
    for (const rotation of [0, 45, 90, 135, 179.999, 270, 359.99]) {
      for (const gap of [-0.1, -2e-9, -1e-9, 0, 1e-9, 2e-9, 0.1, 10]) {
        const obstacle = {
          type: "rect" as const,
          center: { x: 0, y: 0.25 + gap },
          width: 0.2,
          height: 0.2,
          layers: ["top"],
          connectedTo: ["foreign"],
          componentId: "foreign",
          shape,
          ccwRotationDegrees: rotation,
        }
        expectExactObstacleClearance(
          { segment, obstacle, clearance: 0.1 },
          context,
        )
      }
    }
  }
  const fractions = deterministicFractions(0x3132426)
  for (let index = 0; index < 4000; index++) {
    const [x1, y1, x2, y2, width, x, y, sizeX, sizeY, angle, gap] = Array.from(
      { length: 11 },
      () => fractions.next().value,
    )
    const scale = [1e-8, 1, 1000][index % 3]!
    const segment: RoutedSegment = {
      start: { x: (x1 * 10 - 5) * scale, y: (y1 * 10 - 5) * scale },
      end: { x: (x2 * 10 - 5) * scale, y: (y2 * 10 - 5) * scale },
      width: width * 0.5 * scale,
      layer: "top",
    }
    const obstacle = {
      type: "rect" as const,
      center: { x: (x * 10 - 5) * scale, y: (y * 10 - 5) * scale },
      width: index % 11 === 0 ? 0 : sizeX * 3 * scale,
      height: index % 13 === 0 ? 0 : sizeY * 3 * scale,
      layers: index % 17 === 0 ? ["bottom"] : ["top"],
      connectedTo: ["foreign"],
      componentId: "foreign",
      shape: index % 2 === 0 ? "circle" : undefined,
      ccwRotationDegrees: angle * 720 - 360,
    }
    expectExactObstacleClearance(
      { segment, obstacle, clearance: gap * 0.3 * scale },
      context,
    )
  }
})
