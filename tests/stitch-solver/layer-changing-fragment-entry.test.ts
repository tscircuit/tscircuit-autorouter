import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"

test("a layer-changing fragment uses its reachable same-layer end and retains a necessary layer jump", (): void => {
  const baseRoute = { connectionName: "transition", traceThickness: 0.1, viaDiameter: 0.3, vias: [] }
  const startRoute = { ...baseRoute, startPcbPortId: "start", route: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }] }
  const transition = { ...baseRoute, vias: [{ x: 0.1, y: 1 }], route: [{ x: 0, y: 1, z: 1 }, { x: 0.1, y: 1, z: 1 }, { x: 0.1, y: 1, z: 0 }] }
  const tail = { ...baseRoute, endPcbPortId: "end", route: [{ x: 0.2, y: 1, z: 1 }, { x: 1, y: 1, z: 1 }] }
  const normal = new SingleHighDensityRouteStitchSolver3({
    connectionName: "transition", hdRoutes: [startRoute, transition, tail],
    start: { x: 0, y: 0, z: 0, pcb_port_id: "start" }, end: { x: 1, y: 1, z: 1, pcb_port_id: "end" },
    preserveTerminalPcbPortIds: true, preferSameLayerTerminalEndpoints: true, layerCount: 2,
    isStitchSegmentClear: (): boolean => true, stitchClearanceMode: "require_clear",
  })
  normal.solve()
  expect(normal.solved).toBe(true)
  expect(normal.failed).toBe(false)
  expect(normal.mergedHdRoute.route.at(-1)).toEqual({ x: 1, y: 1, z: 1 })
  const changes = normal.mergedHdRoute.route.slice(0, -1).flatMap((point, index) => point.z !== normal.mergedHdRoute.route[index + 1]!.z ? [point] : [])
  expect(changes).toHaveLength(1)
  expect(changes[0]).toEqual({ x: 0.1, y: 1, z: 0 })

  const blockedPlanar = new SingleHighDensityRouteStitchSolver3({
    connectionName: "transition", hdRoutes: [startRoute, { ...transition, endPcbPortId: "end" }],
    start: { x: 0, y: 0, z: 0, pcb_port_id: "start" }, end: { x: 0.1, y: 1, z: 0, pcb_port_id: "end" },
    preserveTerminalPcbPortIds: true, preferSameLayerTerminalEndpoints: true, layerCount: 2,
    isStitchSegmentClear: (): boolean => false, stitchClearanceMode: "require_clear",
  })
  blockedPlanar.solve()
  expect(blockedPlanar.solved).toBe(true)
  expect(blockedPlanar.failed).toBe(false)
  expect(blockedPlanar.mergedHdRoute.route.at(-1)).toEqual({ x: 0.1, y: 1, z: 0 })
})
