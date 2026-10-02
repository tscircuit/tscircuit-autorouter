import { expect, test } from "bun:test"
import { createDynamicNetTreeProblem } from "lib/solvers/DynamicNetTreeSolver/createDynamicNetTreeProblem"
import { routeDynamicNetTree } from "lib/solvers/DynamicNetTreeSolver/routeDynamicNetTree"
import type {
  PostRoutingPhysicalInput,
  PostRoutingObstacle,
} from "lib/solvers/DynamicNetTreeSolver/createDynamicNetTreeProblem"
import { options } from "./fixtures"

test("explicit drilled plated pads bridge layers while unplated multilayer lands require a new physical connection", () => {
  const pad: PostRoutingObstacle = {
    type: "rect",
    center: { x: 0, y: 0 },
    width: 0.8,
    height: 0.8,
    layers: ["top", "bottom"],
    connectedTo: ["A", "arbitrary-pad-name"],
    isPlated: true,
    holeDiameter: 0.3,
  }
  const srj: PostRoutingPhysicalInput = {
    layerCount: 2,
    minTraceWidth: 0.2,
    bounds: { minX: -3, maxX: 13, minY: -3, maxY: 3 },
    connections: [
      {
        name: "N",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pointId: "A" },
          { x: 10, y: 0, layer: "bottom", pointId: "B" },
        ],
      },
    ],
    obstacles: [pad],
  }
  const plated = routeDynamicNetTree(
    createDynamicNetTreeProblem(srj, "N", [], new Map()),
    { ...options, maxViasPerNet: 0 },
  )
  expect(plated.solved).toBe(true)
  expect(plated.stats.insertedVias).toBe(0)
  expect(plated.stats.finalComponents).toBe(1)
  pad.isPlated = false
  delete pad.holeDiameter
  const blocked = routeDynamicNetTree(
    createDynamicNetTreeProblem(srj, "N", [], new Map()),
    { ...options, maxViasPerNet: 0 },
  )
  expect(blocked.solved).toBe(false)
  expect(blocked.traces).toEqual([])
  const unplated = routeDynamicNetTree(
    createDynamicNetTreeProblem(srj, "N", [], new Map()),
    { ...options, maxViasPerNet: 1 },
  )
  expect(unplated.solved).toBe(true)
  expect(unplated.stats.insertedVias).toBe(1)
})
