import { expect, test } from "bun:test"
import { getTerminalLayerIndicesByPcbPortId } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getTerminalLayerIndicesByPcbPortId"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { Obstacle, SimpleRouteConnection } from "lib/types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("stitches real bottom contacts of plated terminals without adding a via", (): void => {
  const connection: SimpleRouteConnection = {
    name: "plated-pair",
    pointsToConnect: [
      { x: 0, y: 0, layer: "top", pcb_port_id: "plated-start" },
      { x: 4, y: 0, layer: "top", pcb_port_id: "plated-end" },
    ],
  }
  const obstacles: Obstacle[] = connection.pointsToConnect.map(
    (point): Obstacle => ({
      type: "rect",
      center: { x: point.x, y: point.y },
      width: 1,
      height: 1,
      layers: ["top", "bottom"],
      connectedTo: [point.pcb_port_id!],
    }),
  )
  const hdRoute: HighDensityIntraNodeRoute = {
    connectionName: connection.name,
    startPcbPortId: "plated-start",
    endPcbPortId: "plated-end",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 1 },
      { x: 2, y: 0, z: 1 },
      { x: 4, y: 0, z: 1 },
    ],
    vias: [],
  }
  const original = structuredClone(hdRoute)
  const terminalLayerIndicesByPcbPortId = getTerminalLayerIndicesByPcbPortId(
    [connection],
    obstacles,
    2,
  )
  const options = {
    connectionName: connection.name,
    hdRoutes: [hdRoute],
    start: { x: 0, y: 0, z: 0, pcb_port_id: "plated-start" },
    end: { x: 4, y: 0, z: 0, pcb_port_id: "plated-end" },
    allowedLayerTransitionPointKeys: new Set<string>(),
    preserveTerminalPcbPortIds: true,
    validateTerminalContacts: true,
    isStitchSegmentClear: (): boolean => true,
    stitchClearanceMode: "require_clear" as const,
  }
  const single = new SingleHighDensityRouteStitchSolver3({
    ...options,
    terminalLayerIndicesByPcbPortId,
  })
  single.solve()
  expect(single.solved).toBeTrue()
  expect(single.failed).toBeFalse()
  expect(single.mergedHdRoute.route).toEqual(hdRoute.route)
  expect(single.mergedHdRoute.vias).toEqual([])

  const multiple = new MultipleHighDensityRouteStitchSolver3({
    connections: [connection],
    hdRoutes: [hdRoute],
    layerCount: 2,
    allowedLayerTransitionPointKeys: new Set<string>(),
    preserveTerminalPcbPortIds: true,
    validateTerminalContacts: true,
    preferSameLayerTerminalEndpoints: true,
    terminalLayerIndicesByPcbPortId,
  })
  multiple.solve()
  expect(multiple.solved).toBeTrue()
  expect(multiple.failed).toBeFalse()
  expect(multiple.mergedHdRoutes).toHaveLength(1)
  const merged = multiple.mergedHdRoutes[0]!
  expect(merged.startPcbPortId).toBe("plated-start")
  expect(merged.endPcbPortId).toBe("plated-end")
  expect(merged.route).toEqual(hdRoute.route)
  expect(merged.vias).toEqual([])
  expect(hdRoute).toEqual(original)

  // Without physical layer metadata, the declared layer remains required.
  const legacy = new SingleHighDensityRouteStitchSolver3(options)
  legacy.solve()
  expect(legacy.solved).toBeFalse()
  expect(legacy.failed).toBeTrue()
  expect(legacy.mergedHdRoute.route[0]!.z).toBe(0)

  const singleLayer = new SingleHighDensityRouteStitchSolver3({
    ...options,
    terminalLayerIndicesByPcbPortId: new Map([
      ["plated-start", new Set([0])],
      ["plated-end", new Set([0])],
    ]),
  })
  singleLayer.solve()
  expect(singleLayer.solved).toBeFalse()
  expect(singleLayer.failed).toBeTrue()
})
