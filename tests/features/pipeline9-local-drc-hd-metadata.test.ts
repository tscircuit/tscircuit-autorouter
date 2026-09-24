import { expect, test } from "bun:test"
import { applyLocalDrcRepairToHdRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyLocalDrcRepairToHdRoute"
import type { SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"

test("joint DRC transfers repairs to HD geometry without losing widths, duplicate points or terminal metadata", (): void => {
  const hdRoute: HighDensityRoute = {
    connectionName: "branch",
    rootConnectionName: "net",
    startPcbPortId: "start",
    endPcbPortId: "end",
    regionId: "region",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -2, y: 0, z: 0, pcb_port_id: "start", traceThickness: 0.2 },
      { x: -1, y: 0, z: 0, traceThickness: 0.15 },
      { x: -1, y: 0, z: 0, traceThickness: 0.15, insideJumperPad: false },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 3 },
      { x: 1, y: 0, z: 3, traceThickness: 0.15 },
      { x: 2, y: 0, z: 3, pcb_port_id: "end", traceThickness: 0.2 },
    ],
    vias: [{ x: 0, y: 0 }],
  }
  const before: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "branch_0",
    connection_name: "net",
    route: convertHdRouteToSimplifiedRoute(hdRoute, 4),
  }
  const after = structuredClone(before)
  for (const point of after.route) {
    if (point.route_type !== "wire" && point.route_type !== "via") continue
    if (point.x === 0) point.x = 0.02
    if (point.x === -1) point.y = 0.01
  }
  const original = structuredClone(hdRoute)
  const repaired = applyLocalDrcRepairToHdRoute({ hdRoute, before, after, layerCount: 4 })
  expect(hdRoute).toEqual(original)
  expect(repaired.route).toHaveLength(original.route.length)
  expect(repaired.route.map(({ x, y, ...metadata }) => metadata)).toEqual(
    original.route.map(({ x, y, ...metadata }) => metadata),
  )
  expect(repaired.route[1]!.y).toBe(0.01)
  expect(repaired.route[2]!.y).toBe(0.01)
  expect(repaired.route[3]!.x).toBe(0.02)
  expect(repaired.route[4]!.x).toBe(0.02)
  expect(repaired.vias).toEqual([{ x: 0.02, y: 0 }])
  expect(repaired.route[0]).toEqual(original.route[0])
  expect(repaired.route.at(-1)).toEqual(original.route.at(-1))
  expect(convertHdRouteToSimplifiedRoute(repaired, 4)).toEqual(after.route)
})
