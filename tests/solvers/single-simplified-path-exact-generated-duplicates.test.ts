import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SingleSimplifiedPathSolver5 } from "lib/solvers/SimplifiedPathSolver/SingleSimplifiedPathSolver5_Deg45"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("generated straight and diagonal paths omit exact duplicates but retain a real via", (): void => {
  const directions: Array<{ x: number; y: number }> = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ]

  for (const direction of directions) {
    const via = { x: 2 * direction.x, y: 2 * direction.y }
    const inputRoute: HighDensityRoute = {
      connectionName: "signal",
      rootConnectionName: "signal-net",
      startPcbPortId: "start-port",
      endPcbPortId: "end-port",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        {
          x: 0,
          y: 0,
          z: 0,
          pcb_port_id: "start-port",
          traceThickness: 0.12,
        },
        { ...via, z: 0 },
        { ...via, z: 1 },
        { x: 4 * direction.x, y: 4 * direction.y, z: 1 },
      ],
      vias: [via],
    }
    const originalInput = structuredClone(inputRoute)
    const solver = new SingleSimplifiedPathSolver5({
      inputRoute,
      otherHdRoutes: [],
      obstacles: [],
      connMap: new ConnectivityMap({ "signal-net": ["signal"] }),
      colorMap: {},
    })

    solver.solve()

    expect(solver.failed).toBeFalse()
    expect(solver.solved).toBeTrue()
    const output = solver.simplifiedRoute
    expect(output.route[0]).toEqual(originalInput.route[0])
    expect(output.route.at(-1)).toEqual(originalInput.route.at(-1))
    expect(output.startPcbPortId).toBe("start-port")
    expect(output.endPcbPortId).toBe("end-port")
    expect(output.traceThickness).toBe(originalInput.traceThickness)
    expect(output.viaDiameter).toBe(originalInput.viaDiameter)
    expect(output.vias).toEqual(originalInput.vias)

    let transitionCount = 0
    for (let index = 0; index < output.route.length; index++) {
      const point = output.route[index]!
      expect(point.x * direction.y).toBe(point.y * direction.x)
      const progress =
        (point.x * direction.x + point.y * direction.y) /
        (direction.x ** 2 + direction.y ** 2)
      expect(progress).toBeGreaterThanOrEqual(point.z === 0 ? 0 : 2)
      expect(progress).toBeLessThanOrEqual(point.z === 0 ? 2 : 4)
      expect([0, 1]).toContain(point.z)

      const previous = output.route[index - 1]
      if (!previous) continue
      expect(
        previous.x === point.x &&
          previous.y === point.y &&
          previous.z === point.z,
      ).toBeFalse()
      if (previous.z !== point.z) {
        transitionCount++
        expect(previous).toEqual({ ...via, z: 0 })
        expect(point).toEqual({ ...via, z: 1 })
      }
    }

    expect(transitionCount).toBe(1)
    expect(inputRoute).toEqual(originalInput)
  }
})
