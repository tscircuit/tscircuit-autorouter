import { expect, test, describe } from "bun:test"
import { CapacityMeshSolver } from "../lib"
import {
  calculateOptimalCapacityDepth,
  getTunedTotalCapacity1,
} from "../lib/utils/getTunedTotalCapacity1"

describe("Auto Capacity Depth", () => {
  test("calculateOptimalCapacityDepth returns appropriate depth", () => {
    // Small board
    const smallBoardDepth = calculateOptimalCapacityDepth(10, 0.5)
    expect(smallBoardDepth).toBeGreaterThan(0)

    // Large board
    const largeBoardDepth = calculateOptimalCapacityDepth(100, 0.5)
    expect(largeBoardDepth).toBeGreaterThan(smallBoardDepth)

    // Verify relationship between width and depth
    const width1 = 50
    const width2 = 100
    const depth1 = calculateOptimalCapacityDepth(width1, 0.5)
    const depth2 = calculateOptimalCapacityDepth(width2, 0.5)
    expect(depth2).toBeGreaterThan(depth1) // Larger board needs more subdivisions

    // Verify relationship between targetCapacity and depth
    const targetCap1 = 0.2
    const targetCap2 = 0.8
    const depthA = calculateOptimalCapacityDepth(100, targetCap1)
    const depthB = calculateOptimalCapacityDepth(100, targetCap2)
    expect(depthA).toBeGreaterThan(depthB) // Lower target capacity needs more subdivisions
  })

  test("getTunedTotalCapacity1 accepts both node and width", () => {
    const width = 10
    const node = {
      width,
      capacityMeshNodeId: "test",
      center: { x: 0, y: 0 },
      height: 10,
      layer: "top",
    }

    const capacity1 = getTunedTotalCapacity1(node)
    const capacity2 = getTunedTotalCapacity1({ width })

    expect(capacity1).toEqual(capacity2)
  })

  test("getTunedTotalCapacity1 lowers capacity for thin rectangles", () => {
    const squareCapacity = getTunedTotalCapacity1({ width: 4, height: 4 })
    const thinCapacity = getTunedTotalCapacity1({ width: 16, height: 1 })

    expect(thinCapacity).toBeLessThan(squareCapacity)
  })

  test("getTunedTotalCapacity1 responds to via diameter option", () => {
    const defaultCapacity = getTunedTotalCapacity1({ width: 2, height: 2 })
    const largerViaCapacity = getTunedTotalCapacity1(
      { width: 2, height: 2 },
      1,
      { viaDiameter: 0.6 },
    )

    expect(largerViaCapacity).toBeLessThan(defaultCapacity)
  })
  // Needs larger simple route json to test
  // test("CapacityMeshSolver automatically calculates capacityDepth", () => {
  //   const simpleRouteJson = {
  //     layerCount: 2,
  //     minTraceWidth: 0.15,
  //     obstacles: [],
  //     connections: [],
  //     bounds: { minX: 0, maxX: 100, minY: 0, maxY: 80 },
  //   }

  //   // Create solver without specifying capacityDepth
  //   const solver = new CapacityMeshSolver(simpleRouteJson)

  //   // Check that nodeSolver's MAX_DEPTH is set to a reasonable value
  //   expect(solver.nodeSolver?.MAX_DEPTH).toBeGreaterThan(0)

  //   // Create another solver with a much smaller board
  //   const smallBoardJson = {
  //     ...simpleRouteJson,
  //     bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10 },
  //   }
  //   const smallSolver = new CapacityMeshSolver(smallBoardJson)

  //   // Check that the smaller board has a smaller depth
  //   expect(smallSolver.nodeSolver?.MAX_DEPTH).toBeLessThanOrEqual(
  //     solver.nodeSolver?.MAX_DEPTH!,
  //   )
  // })
})
