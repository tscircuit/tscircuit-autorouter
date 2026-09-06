import { expect, test } from "bun:test"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

type RoutePoint = HighDensityRoute["route"][number]

test("terminal tapers follow pad entry beyond in-pad bends", (): void => {
  const rotations: number[] = [0, 30, 90]
  const directions: boolean[] = [false, true]
  for (const rotationDegrees of rotations) {
    for (const reverse of directions) {
      const rotationRadians: number = (rotationDegrees * Math.PI) / 180
      const cos: number = Math.cos(rotationRadians)
      const sin: number = Math.sin(rotationRadians)
      const originalPoints: RoutePoint[] = [
        { x: 2, y: 0, z: 0 },
        { x: 0.1, y: 0, z: 0 },
        { x: 0, y: -0.1, z: 0 },
      ]
      const points: RoutePoint[] = originalPoints.map(
        (point: RoutePoint): RoutePoint => ({
          ...point,
          x: point.x * cos - point.y * sin,
          y: point.x * sin + point.y * cos,
        }),
      )
      const route: HighDensityRoute = {
        connectionName: "terminal-route",
        traceThickness: 0.5,
        viaDiameter: 0.3,
        route: reverse ? [...points].reverse() : points,
        vias: [],
      }
      const pad: Obstacle = {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 1.2,
        height: 0.3,
        ccwRotationDegrees: rotationDegrees,
        layers: ["top"],
        connectedTo: [route.connectionName],
      }
      const inputBefore: string = JSON.stringify({ route, pad })
      const solver: TraceWidthSolver = new TraceWidthSolver({
        hdRoutes: [route],
        obstacles: [pad],
        connection: [],
        minTraceWidth: 0.5,
        layerCount: 2,
      })
      solver.solve()
      const output: HighDensityRoute = solver.getHdRoutesWithWidths()[0]!

      expect(solver.solved).toBe(true)
      expect(JSON.stringify({ route, pad })).toBe(inputBefore)
      expect(output.route[0]).toMatchObject(route.route[0]!)
      expect(output.route.at(-1)).toMatchObject(route.route.at(-1)!)
      for (const point of output.route) {
        const localX: number = point.x * cos + point.y * sin
        if (localX <= pad.width / 2) {
          expect(point.traceThickness).toBeLessThanOrEqual(pad.height + 1e-9)
        }
      }
      const outsidePoint: RoutePoint = output.route.find(
        (point: RoutePoint): boolean => point.x * cos + point.y * sin > 1,
      )!
      expect(outsidePoint.traceThickness).toBe(0.5)
    }
  }
})
