import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { convertPreloadedTraceToHdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { createIntraNodeSegmentValidator } from "lib/solvers/HyperHighDensitySolver/createIntraNodeSegmentValidator"
import type { SimplifiedPcbTrace } from "lib/types"
import type { ConnectionName } from "lib/types/srj-types"

test("preloaded wire domains constrain search without blocking through vias or losing copper clearance", (): void => {
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "data",
    connection_name: "data",
    allowedLayers: ["top", "bottom"],
    route: [
      { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
    ],
  }
  const connMap = new ConnectivityMap({})
  const [route] = convertPreloadedTraceToHdRoutes(trace, 0, 4, 0.3, connMap)
  expect(route!.allowedZLayers).toEqual([0, 3])
  const context = {
    fixedHdRoutes: [],
    allowedZLayersByConnectionName: new Map<ConnectionName, readonly number[]>([
      ["data", route!.allowedZLayers!],
    ]),
    connMap,
    layerCount: 4,
    clearance: 0.1,
  }
  const segment = {
    connectionName: "data",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    start: { x: -1, y: 1, z: 0 },
    end: { x: 1, y: 1, z: 0 },
  }
  for (const fixedHdRoutes of [[], [{ ...route!, connectionName: "foreign", rootConnectionName: "foreign" }]]) {
    const validate = createIntraNodeSegmentValidator({ ...context, fixedHdRoutes })
    expect(validate(segment)).toBe(true)
    expect(validate({
      ...segment,
      start: { x: -1, y: 1, z: 1 },
      end: { x: 1, y: 1, z: 1 },
    })).toBe(false)
    expect(validate({
      ...segment,
      start: { x: -1, y: 1, z: 0 },
      end: { x: -1, y: 1, z: 3 },
    })).toBe(true)
  }
  const validateCopper = createIntraNodeSegmentValidator({
    ...context,
    fixedHdRoutes: [{ ...route!, connectionName: "foreign", rootConnectionName: "foreign" }],
  })
  expect(validateCopper({
    ...segment,
    start: { x: 0, y: -1, z: 0 },
    end: { x: 0, y: 1, z: 0 },
  })).toBe(false)
})
