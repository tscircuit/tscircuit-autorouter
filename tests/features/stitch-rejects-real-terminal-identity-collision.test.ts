import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"

test("layer-aware stitching still rejects real duplicate and unknown terminal identities", (): void => {
  const params: ConstructorParameters<typeof SingleHighDensityRouteStitchSolver3>[0] = {
    connectionName: "collision",
    hdRoutes: [{ connectionName: "collision", traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], vias: [] }],
    start: { x: 0, y: 0, z: 0, pcb_port_id: "same-port" },
    end: { x: 1, y: 0, z: 0, pcb_port_id: "same-port" },
    preserveTerminalPcbPortIds: true,
    preferSameLayerTerminalEndpoints: true,
    layerCount: 8,
    isStitchSegmentClear: (): boolean => true,
    stitchClearanceMode: "require_clear",
  }
  expect(() => new SingleHighDensityRouteStitchSolver3(params)).toThrow('duplicate PCB terminal "same-port"')
  expect(() => new SingleHighDensityRouteStitchSolver3({
    ...params,
    start: { ...params.start, pcb_port_id: "start-port" },
    end: { ...params.end, pcb_port_id: "end-port" },
    hdRoutes: [{ ...params.hdRoutes[0]!, startPcbPortId: "unknown-port" }],
  })).toThrow('unknown PCB terminal "unknown-port"')
})
