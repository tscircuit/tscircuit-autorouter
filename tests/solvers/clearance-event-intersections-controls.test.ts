import { expect, test } from "bun:test"
import { findSingleTransitionVia, type SingleTransitionBoardContext } from "../../lib/solvers/HighDensitySolver/findSingleTransitionVia"
import type { PortPoint } from "../../lib/types/high-density-types"
import type { Obstacle } from "../../lib/types/srj-types"

test("crossed clearance events solve perpendicular barriers without changing existing nominal or shortlist choices", () => {
  const vertical: Obstacle = { type: "rect", center: { x: 0, y: 0 }, width: 0.2, height: 4,
    layers: ["bottom"], zLayers: [7], connectedTo: ["foreignPad"] }
  const horizontal: Obstacle = { ...vertical, width: 4, height: 0.2 }
  const start: PortPoint = { x: 0, y: 0, z: 0, connectionName: "moving" }
  const end: PortPoint = { ...start, z: 1 }
  const context: SingleTransitionBoardContext = { obstacles: [vertical, horizontal], layerCount: 8,
    allowBlindAndBuriedVias: false, coordinateScale: 1, viaToPadClearance: 0.1,
    traceToPadClearance: 0.1, traceToHoleClearance: 0.2,
    boardGeometry: { bounds: { minX: -0.8, maxX: 0.8, minY: -0.8, maxY: 0.8 } } }
  const input = { nominal: { x: 0, y: 0 }, start, end, connectionName: "moving",
    center: { x: 0, y: 0 }, viaDiameter: 0.3, traceThickness: 0.1, context }
  const before = JSON.stringify(input)
  const via = findSingleTransitionVia(input)
  expect(via).toBeDefined()
  // Each single-axis projection hits the other bar. Its far corners lie outside the board.
  // Combining the two independent .1 pad-edge clearance events opens a real corner gap.
  expect(Math.abs(via!.x)).toBeCloseTo(0.350001, 9)
  expect(Math.abs(via!.y)).toBeCloseTo(0.350001, 9)
  expect(Math.abs(via!.x) - vertical.width / 2).toBeGreaterThanOrEqual(0.25 - 1e-9)
  expect(Math.abs(via!.y) - horizontal.height / 2).toBeGreaterThanOrEqual(0.25 - 1e-9)
  expect(JSON.stringify(input)).toBe(before)

  const unobstructed = { ...input, context: { ...context, obstacles: [] } }
  expect(findSingleTransitionVia(unobstructed)).toBe(unobstructed.nominal)
  const shortlist = findSingleTransitionVia({ ...input, context: { ...context, obstacles: [vertical] } })
  const originalEvent = vertical.width / 2 + (input.viaDiameter / 2 + context.viaToPadClearance) + 1e-6
  expect(shortlist).toEqual({ x: -originalEvent, y: 0 })
  const cover: Obstacle = { ...vertical, width: 4, height: 4 }
  expect(findSingleTransitionVia({ ...input,
    context: { ...context, obstacles: [vertical, horizontal, cover] } })).toBeUndefined()
  expect(findSingleTransitionVia({ ...input, context: { ...context,
    obstacles: context.obstacles.map((obstacle) => ({ ...obstacle, connectedTo: ["moving"] })) } })).toBe(input.nominal)

  const center = { x: 10, y: 20 }
  for (const scale of [0.5, 2]) {
    const result = findSingleTransitionVia({ ...input, center, nominal: center,
      start: { ...start, ...center }, end: { ...end, ...center },
      context: { ...context, coordinateScale: scale,
        obstacles: context.obstacles.map((obstacle) => ({ ...obstacle, center })),
        boardGeometry: { bounds: { minX: 9.2, maxX: 10.8, minY: 19.2, maxY: 20.8 } } } })
    expect(result).toBeDefined()
    expect((result!.x - center.x) / scale).toBeCloseTo(via!.x, 9)
    expect((result!.y - center.y) / scale).toBeCloseTo(via!.y, 9)
  }
})
