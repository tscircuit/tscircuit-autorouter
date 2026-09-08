import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("trace simplification retains one tagged plated-hole departure without adding a via", (): void => {
  const inputRoute: HighDensityRoute = {
    connectionName: "signal",
    rootConnectionName: "signal-net",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 2, y: 0, z: 1 },
      { x: 4, y: 0, z: 1 },
    ],
    vias: [],
  }
  const platedHole: Obstacle = {
    type: "rect",
    layers: ["top", "bottom"],
    center: { x: 2, y: 0 },
    width: 0.6,
    height: 0.6,
    connectedTo: ["signal"],
    circuitJsonMetadata: {
      pcb_plated_hole_id: "plated-hole",
      pcb_port_id: "plated-port",
    },
  }
  const originalRoute = structuredClone(inputRoute)
  const originalObstacle = structuredClone(platedHole)
  const solver = new TraceSimplificationSolver({
    hdRoutes: [inputRoute],
    obstacles: [platedHole],
    connMap: new ConnectivityMap({
      "signal-net": ["signal", "plated-hole", "plated-port"],
    }),
    colorMap: {},
    defaultViaDiameter: 0.3,
    layerCount: 2,
    preserveRouteEndpoints: true,
  })

  solver.solve()

  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(solver.simplifiedHdRoutes).toHaveLength(1)
  const output = solver.simplifiedHdRoutes[0]!
  expect(output.route[0]).toEqual(originalRoute.route[0])
  expect(output.route.at(-1)).toEqual(originalRoute.route.at(-1))
  expect(output.vias).toEqual([])

  let departureCount = 0
  let arrivalCount = 0
  let transitionCount = 0
  let taggedPointCount = 0
  for (let index = 0; index < output.route.length; index++) {
    const point = output.route[index]!
    const nextPoint = output.route[index + 1]
    if (point.x === 2 && point.y === 0 && point.z === 0) {
      departureCount++
      expect(point.toNextSegmentType).toBe("through_obstacle")
      expect(point.toNextSegmentCircuitJsonMetadata).toEqual(
        originalObstacle.circuitJsonMetadata,
      )
      expect(nextPoint).toEqual({ x: 2, y: 0, z: 1 })
    }
    if (point.x === 2 && point.y === 0 && point.z === 1) {
      arrivalCount++
    }
    if (point.toNextSegmentType === "through_obstacle") taggedPointCount++
    if (nextPoint && point.z !== nextPoint.z) transitionCount++
    if (nextPoint) {
      expect(
        point.x === nextPoint.x &&
          point.y === nextPoint.y &&
          point.z === nextPoint.z,
      ).toBeFalse()
    }
  }

  expect(departureCount).toBe(1)
  expect(arrivalCount).toBe(1)
  expect(transitionCount).toBe(1)
  expect(taggedPointCount).toBe(1)
  expect(inputRoute).toEqual(originalRoute)
  expect(platedHole).toEqual(originalObstacle)
})
