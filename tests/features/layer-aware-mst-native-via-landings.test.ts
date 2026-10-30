import { expect, test } from "bun:test"
import { restoreCoincidentNativeViaLandings } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/restoreCoincidentNativeViaLandings"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("lost native two-state via landings are restored without planning new geometry or altering terminals", () => {
  const route: HighDensityIntraNodeRoute = { connectionName: "net", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 3 }], vias: [{ x: 0.25, y: 0.5 }] }
  const before = JSON.stringify(route)
  const result = restoreCoincidentNativeViaLandings(route)
  expect(result.route).toEqual([route.route[0]!, { x: 0.25, y: 0.5, z: 0 }, { x: 0.25, y: 0.5, z: 3 }, route.route[1]!])
  expect(result.route[0]).toBe(route.route[0])
  expect(result.route.at(-1)).toBe(route.route[1])
  expect(result.vias).toBe(route.vias)
  expect(result.viaDiameter).toBe(route.viaDiameter)
  expect(result.traceThickness).toBe(route.traceThickness)
  expect(JSON.stringify(route)).toBe(before)
  for (const value of [
    { ...route, vias: [] },
    { ...route, vias: [{ x: 0.2, y: 0.3 }, { x: 0.4, y: 0.5 }] },
    { ...route, route: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 3 }] },
    { ...route, route: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }] },
  ]) expect(restoreCoincidentNativeViaLandings(value)).toBe(value)
  expect(() => restoreCoincidentNativeViaLandings({ ...route, vias: [{ x: Number.NaN, y: 0 }] })).toThrow()
})
