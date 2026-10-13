import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import fixture from "./fixtures/lm5155-terminal-cap-orphan.json"

test("caps a reachable SMT terminal after exhausting connected fragments", (): void => {
  const routes = fixture.hdRoutes as HighDensityIntraNodeRoute[]
  const original = structuredClone(routes)
  const options = {
    connectionName: fixture.connectionName,
    start: fixture.start,
    end: fixture.end,
    hdRoutes: routes,
    preserveTerminalPcbPortIds: true,
    validateTerminalContacts: true,
    terminalLayerIndicesByPcbPortId: new Map([
      [fixture.start.pcb_port_id, new Set([0])],
      [fixture.end.pcb_port_id, new Set([0])],
    ]),
    isStitchSegmentClear: (): boolean => true,
    stitchClearanceMode: "require_clear" as const,
  }
  for (const hdRoutes of [routes, [...routes].reverse()]) {
    const solver = new SingleHighDensityRouteStitchSolver3({
      ...options,
      hdRoutes,
    })
    solver.solve()
    expect(solver.solved).toBeTrue()
    expect(solver.failed).toBeFalse()
    expect(solver.mergedHdRoute.startPcbPortId).toBe("pcb_port_109")
    expect(solver.mergedHdRoute.endPcbPortId).toBe("pcb_port_36")
    expect(solver.mergedHdRoute.route.at(-1)).toEqual({
      x: fixture.end.x,
      y: fixture.end.y,
      z: 0,
    })
    expect(solver.mergedHdRoute.route.at(-2)).toEqual({
      x: 38.263,
      y: 49.124,
      z: 0,
    })
    expect(solver.mergedHdRoute.vias).toEqual(routes[0]!.vias)
    expect(solver.remainingHdRoutes).toHaveLength(1)
  }
  expect(routes).toEqual(original)

  const blocked = new SingleHighDensityRouteStitchSolver3({
    ...options,
    isStitchSegmentClear: (): boolean => false,
  })
  blocked.solve()
  expect(blocked.solved).toBeFalse()
  expect(blocked.failed).toBeTrue()

  const wrongLayer = new SingleHighDensityRouteStitchSolver3({
    ...options,
    end: { ...fixture.end, z: 1 },
    terminalLayerIndicesByPcbPortId: new Map([
      [fixture.start.pcb_port_id, new Set([0])],
      [fixture.end.pcb_port_id, new Set([1])],
    ]),
  })
  wrongLayer.solve()
  expect(wrongLayer.solved).toBeFalse()
  expect(wrongLayer.failed).toBeTrue()
  expect(wrongLayer.mergedHdRoute.vias).toHaveLength(0)

  const tooFar = new SingleHighDensityRouteStitchSolver3({
    ...options,
    end: { ...fixture.end, x: fixture.end.x - 4, y: fixture.end.y + 4 },
  })
  tooFar.solve()
  expect(tooFar.solved).toBeFalse()
  expect(tooFar.failed).toBeTrue()
  expect(tooFar.mergedHdRoute.vias).toHaveLength(0)

  const continuation = new SingleHighDensityRouteStitchSolver3({
    connectionName: "complete-path",
    start: { x: 0, y: 0, z: 0, pcb_port_id: "start" },
    end: { x: 3, y: 0, z: 0, pcb_port_id: "end" },
    preserveTerminalPcbPortIds: true,
    validateTerminalContacts: true,
    isStitchSegmentClear: (): boolean => true,
    stitchClearanceMode: "require_clear",
    hdRoutes: [
      {
        connectionName: "complete-path",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          { x: 0, y: 0, z: 0 },
          { x: 2, y: 0, z: 0 },
        ],
        vias: [],
      },
      {
        connectionName: "complete-path",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          { x: 2, y: 0, z: 0 },
          { x: 2.5, y: 0.5, z: 0 },
          { x: 3, y: 0, z: 0 },
        ],
        vias: [],
      },
    ],
  })
  continuation.solve()
  expect(continuation.solved).toBeTrue()
  expect(continuation.mergedHdRoute.route).toContainEqual({
    x: 2.5,
    y: 0.5,
    z: 0,
  })
  expect(continuation.mergedHdRoute.vias).toHaveLength(0)
})
