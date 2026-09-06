import { expect, test } from "bun:test"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

type RoutePoint = HighDensityRoute["route"][number]

test("terminal tapers stop at the terminal layer boundary", (): void => {
  const directions: boolean[] = [false, true]
  const terminalWireCases: boolean[] = [true, false]
  for (const reverse of directions) {
    for (const hasTerminalWire of terminalWireCases) {
      const viaX: number = hasTerminalWire ? 0.1 : 0
      const originalPoints: RoutePoint[] = [
        { x: 0, y: 0, z: 0, pcb_port_id: "terminal-port" },
        ...(hasTerminalWire ? [{ x: viaX, y: 0, z: 0 }] : []),
        { x: viaX, y: 0, z: 1 },
        { x: viaX, y: 2, z: 1, pcb_port_id: "outside-port" },
      ]
      const route: HighDensityRoute = {
        connectionName: "terminal-route",
        traceThickness: 0.5,
        viaDiameter: 0.3,
        route: reverse ? [...originalPoints].reverse() : originalPoints,
        vias: [{ x: viaX, y: 0 }],
      }
      const pad: Obstacle = {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 1.2,
        height: 0.3,
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
      expect(output.vias).toEqual(route.vias)
      expect(output.route[0]).toMatchObject(route.route[0]!)
      expect(output.route.at(-1)).toMatchObject(route.route.at(-1)!)
      for (const originalPoint of originalPoints) {
        const preservedPoint: RoutePoint | undefined = output.route.find(
          (point: RoutePoint): boolean =>
            point.x === originalPoint.x &&
            point.y === originalPoint.y &&
            point.z === originalPoint.z,
        )
        expect(preservedPoint).toMatchObject(originalPoint)
      }
      if (hasTerminalWire) {
        const terminalLayerPoints: RoutePoint[] = output.route.filter(
          (point: RoutePoint): boolean => point.z === 0,
        )
        for (const point of terminalLayerPoints) {
          expect(point.traceThickness).toBeLessThanOrEqual(pad.height + 1e-9)
        }
      } else {
        // An immediate via has no terminal-layer wire direction to taper.
        expect(output.route).toHaveLength(originalPoints.length)
      }
    }
  }
})
