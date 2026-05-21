import { test, expect, describe } from "bun:test"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

describe("High-density connection-specific trace width", () => {
  test("narrow trace (0.15mm) passes through a narrow corridor", () => {
    // 1. Define obstacle traces that form a corridor centered at y = 0.
    const obstacle1: HighDensityIntraNodeRoute = {
      connectionName: "Obstacle1",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -2, y: 0.35, z: 0 },
        { x: 2, y: 0.35, z: 0 },
      ],
      vias: [],
    }

    const obstacle2: HighDensityIntraNodeRoute = {
      connectionName: "Obstacle2",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -2, y: -0.35, z: 0 },
        { x: 2, y: -0.35, z: 0 },
      ],
      vias: [],
    }

    // 2. Solve with a narrow trace connection (B) of 0.15mm.
    const narrowSolver = new IntraNodeRouteSolver({
      nodeWithPortPoints: {
        capacityMeshNodeId: "cmn_test",
        center: { x: 0, y: 0 },
        width: 10,
        height: 10,
        portPoints: [
          { connectionName: "B", x: -4, y: 0, z: 0 },
          { connectionName: "B", x: 4, y: 0, z: 0 },
        ],
      },
      traceWidth: 0.15,
      obstacleMargin: 0.05,
      connectionNominalTraceWidths: {
        B: 0.15,
      },
    })
    narrowSolver.solvedRoutes.push(obstacle1, obstacle2)
    narrowSolver.solve()

    expect(narrowSolver.solved).toBe(true)
    const narrowRoute = narrowSolver.solvedRoutes.find(
      (r) => r.connectionName === "B",
    )
    expect(narrowRoute).toBeDefined()
    expect(narrowRoute!.traceThickness).toBe(0.15)
    // A straight line path should stay along y = 0
    const narrowPoints = narrowRoute!.route
    const maxNarrowY = Math.max(...narrowPoints.map((p) => Math.abs(p.y)))
    expect(maxNarrowY).toBeLessThan(0.1) // stays straight/near center

    // Verify visualization and generate snapshot
    expect(narrowSolver.visualize()).toMatchGraphicsSvg(
      `${import.meta.path}-narrow`,
    )
  })

  test("wide trace (0.6mm) detours around a narrow corridor", () => {
    // 1. Define obstacle traces that form a corridor centered at y = 0.
    const obstacle1: HighDensityIntraNodeRoute = {
      connectionName: "Obstacle1",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -2, y: 0.35, z: 0 },
        { x: 2, y: 0.35, z: 0 },
      ],
      vias: [],
    }

    const obstacle2: HighDensityIntraNodeRoute = {
      connectionName: "Obstacle2",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -2, y: -0.35, z: 0 },
        { x: 2, y: -0.35, z: 0 },
      ],
      vias: [],
    }

    // 2. Solve with a wide trace connection (B) of 0.6mm.
    const wideSolver = new IntraNodeRouteSolver({
      nodeWithPortPoints: {
        capacityMeshNodeId: "cmn_test",
        center: { x: 0, y: 0 },
        width: 10,
        height: 10,
        portPoints: [
          { connectionName: "B", x: -4, y: 0, z: 0 },
          { connectionName: "B", x: 4, y: 0, z: 0 },
        ],
      },
      traceWidth: 0.15,
      obstacleMargin: 0.05,
      connectionNominalTraceWidths: {
        B: 0.6,
      },
    })
    wideSolver.solvedRoutes.push(obstacle1, obstacle2)
    wideSolver.solve()

    expect(wideSolver.solved).toBe(true)
    const wideRoute = wideSolver.solvedRoutes.find(
      (r) => r.connectionName === "B",
    )
    expect(wideRoute).toBeDefined()
    expect(wideRoute!.traceThickness).toBe(0.6)
    // The detour must clear the obstacles
    const widePoints = wideRoute!.route
    const maxWideY = Math.max(...widePoints.map((p) => Math.abs(p.y)))
    expect(maxWideY).toBeGreaterThan(0.5) // successfully detoured!

    // Verify visualization and generate snapshot
    expect(wideSolver.visualize()).toMatchGraphicsSvg(
      `${import.meta.path}-wide`,
    )
  })

  test("cache safety: changing connection-specific nominalTraceWidth invalidates cache key", () => {
    const node = {
      capacityMeshNodeId: "cmn_test_cache",
      center: { x: 0, y: 0 },
      width: 5,
      height: 5,
      portPoints: [
        { connectionName: "A", x: -2, y: 0, z: 0 },
        { connectionName: "A", x: 2, y: 0, z: 0 },
      ],
    }

    const solver1 = new CachedIntraNodeRouteSolver({
      nodeWithPortPoints: node,
      traceWidth: 0.15,
      connectionNominalTraceWidths: {
        A: 0.15,
      },
    })

    const solver2 = new CachedIntraNodeRouteSolver({
      nodeWithPortPoints: node,
      traceWidth: 0.15,
      connectionNominalTraceWidths: {
        A: 0.4,
      },
    })

    const key1 = solver1.computeCacheKeyAndTransform().cacheKey
    const key2 = solver2.computeCacheKeyAndTransform().cacheKey

    expect(key1).not.toBe(key2)
  })
})
