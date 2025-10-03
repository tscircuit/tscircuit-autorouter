import { describe, expect, test } from "bun:test"
import { CapacityMeshSolver } from "../../lib"
import type { SimpleRouteJson } from "../../lib/types"

describe("AutoroutingPipelineSolver uses outline for auto capacity depth", () => {
  test("smaller outline yields smaller auto capacity depth than large bounds", () => {
    const srjLargeBounds: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.15,
      obstacles: [],
      connections: [],
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    }

    const srjWithSmallOutline: SimpleRouteJson = {
      ...srjLargeBounds,
      outline: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
    }

    const solverBoundsOnly = new CapacityMeshSolver(srjLargeBounds)
    const solverWithOutline = new CapacityMeshSolver(srjWithSmallOutline)

    expect(solverBoundsOnly.opts.capacityDepth).toBeGreaterThan(0)
    expect(solverWithOutline.opts.capacityDepth).toBeGreaterThan(0)
    // With outline present, auto-depth should be based on outline (smaller)
    expect(solverWithOutline.opts.capacityDepth!).toBeLessThan(
      solverBoundsOnly.opts.capacityDepth!,
    )
  })

  test("larger outline yields larger auto capacity depth than small bounds", () => {
    const srjSmallBounds: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.15,
      obstacles: [],
      connections: [],
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    }

    const srjWithLargeOutline: SimpleRouteJson = {
      ...srjSmallBounds,
      outline: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
    }

    const solverBoundsOnly = new CapacityMeshSolver(srjSmallBounds)
    const solverWithOutline = new CapacityMeshSolver(srjWithLargeOutline)

    expect(solverBoundsOnly.opts.capacityDepth).toBeGreaterThan(0)
    expect(solverWithOutline.opts.capacityDepth).toBeGreaterThan(0)
    // With larger outline, auto-depth should increase
    expect(solverWithOutline.opts.capacityDepth!).toBeGreaterThan(
      solverBoundsOnly.opts.capacityDepth!,
    )
  })
})
