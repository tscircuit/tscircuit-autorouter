import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { InitialBgaTopologySolver } from "lib/solvers/BgaTopologyGeneratorSolver/InitialBgaTopologySolver"
import { canFitViaInBgaGap } from "lib/solvers/BgaTopologyGeneratorSolver/canFitViaInBgaGap"
import type { SimpleRouteJson } from "lib/types"
import { addApproximatingRectsToSrj } from "lib/utils/addApproximatingRectsToSrj"

test("round BGA pads retain a clearance-checked via pocket between rows", () => {
  const inputSrj: SimpleRouteJson = JSON.parse(
    readFileSync(
      new URL("../fixtures/bga-round-pad-via-gap.json", import.meta.url),
      "utf8",
    ),
  )
  const srj = addApproximatingRectsToSrj(inputSrj)
  expect(srj.obstacles.every((obstacle) => obstacle.shape === "circle")).toBe(
    true,
  )
  const solver = new InitialBgaTopologySolver({
    srj,
    componentId: "chip",
    componentBounds: srj.bounds,
    markedComponentObstacles: srj.obstacles,
    unmarkedComponentObstacles: [],
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const centerNodes = solver
    .getOutput()
    .filter(
      (node) =>
        Math.abs(node.center.x) < 1e-9 && Math.abs(node.center.y) < 1e-9,
    )
  expect(centerNodes).toHaveLength(1)
  const gap = centerNodes[0]!
  expect(gap.availableZ).toEqual([0, 1, 2, 3])
  expect(gap.width).toBeCloseTo(0.44)
  expect(gap.height).toBeCloseTo(0.3)
  for (const obstacle of srj.obstacles) {
    const copperClearance =
      Math.hypot(
        gap.center.x - obstacle.center.x,
        gap.center.y - obstacle.center.y,
      ) -
      obstacle.width / 2 -
      0.3 / 2
    expect(copperClearance).toBeGreaterThanOrEqual(0.15)
  }
  const constraints = {
    gap,
    obstacles: srj.obstacles,
    viaDiameter: 0.3,
    clearance: 0.15,
    freeLayers: [0, 1, 2, 3],
    layerCount: 4,
  }
  expect(canFitViaInBgaGap(constraints)).toBe(true)
  expect(canFitViaInBgaGap({ ...constraints, clearance: 0.16 })).toBe(false)
  expect(canFitViaInBgaGap({ ...constraints, viaDiameter: 0.31 })).toBe(false)
  expect(
    canFitViaInBgaGap({
      ...constraints,
      obstacles: srj.obstacles.map(({ shape, ...obstacle }) => obstacle),
    }),
  ).toBe(false)
  expect(
    canFitViaInBgaGap({
      ...constraints,
      obstacles: [
        ...srj.obstacles,
        {
          type: "rect",
          layers: ["inner1"],
          center: { x: 0, y: 0 },
          width: 0.1,
          height: 0.1,
          connectedTo: ["foreign"],
        },
      ],
    }),
  ).toBe(false)
})
