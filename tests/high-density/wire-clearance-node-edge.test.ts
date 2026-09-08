import { expect, test } from "bun:test"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

test("native routing reserves copper clearance across a shared node edge", (): void => {
  for (const offset of [
    { x: 0, y: 0 },
    { x: 12, y: -8 },
  ]) {
    const point = (
      x: number,
      y: number,
    ): { x: number; y: number; z: number } => ({
      x: x + offset.x,
      y: y + offset.y,
      z: 0,
    })
    const A = point(0.09, -0.43)
    const B = point(3.72, -0.08)
    const solver = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost({
      connectionName: "signal",
      obstacleRoutes: [],
      futureConnections: [
        { connectionName: "other", points: [point(0.09, -3), point(4.09, -3)] },
      ],
      minDistBetweenEnteringPoints: 0.3,
      bounds: {
        minX: 0.09 + offset.x,
        maxX: 4.09 + offset.x,
        minY: -4.08 + offset.y,
        maxY: -0.08 + offset.y,
      },
      A,
      B,
      traceThickness: 0.15,
      obstacleMargin: 0.15,
      availableZ: [0],
      captureSearchDebug: false,
    })
    solver.solve()
    expect(solver.failed).toBe(false)
    expect(solver.solved).toBe(true)
    const result = solver.solvedPath
    if (!result) throw new Error("Solved edge fixture requires a routed output")
    expect(result.route[0]).toEqual(A)
    expect(result.route.at(-1)).toEqual(B)
    expect(result.traceThickness).toBe(0.15)
    expect(result.vias).toHaveLength(0)

    // The neighboring node can place its wire radius plus half the gap away
    // from this boundary. Neither solver sees the other node's route.
    const neighborStart = point(0.7, 0.07)
    const neighborEnd = point(2.7, 0.07)
    const neighborRadius = 0.075
    for (let index = 1; index < result.route.length; index++) {
      const start = result.route[index - 1]!
      const end = result.route[index]!
      const centerlineDistance = Math.min(
        pointToSegmentDistance(start, neighborStart, neighborEnd),
        pointToSegmentDistance(end, neighborStart, neighborEnd),
        pointToSegmentDistance(neighborStart, start, end),
        pointToSegmentDistance(neighborEnd, start, end),
      )
      expect(
        centerlineDistance - result.traceThickness / 2 - neighborRadius,
      ).toBeGreaterThanOrEqual(0.15 - 1e-9)
    }
  }
})
