import { expect, test } from "bun:test"
import { getUniqueStitchRoutes } from "lib/solvers/RouteStitchingSolver/routeStitchingShared"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("exact stitch deduplication preserves nearby copper, dimensions, identity and segment metadata", (): void => {
  const route: HighDensityIntraNodeRoute = {
    connectionName: "signal", rootConnectionName: "signal_root",
    traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 3 }],
    vias: [{ x: 0, y: 0 }],
  }
  const nearby: HighDensityIntraNodeRoute = {
    ...structuredClone(route),
    route: [{ x: 1e-8, y: 0, z: 0 }, { x: 1e-8, y: 0, z: 3 }],
    vias: [{ x: 1e-8, y: 0 }],
  }
  const different = [
    nearby,
    { ...structuredClone(route), traceThickness: 0.10000001 },
    { ...structuredClone(route), viaDiameter: 0.30000001 },
    { ...structuredClone(route), connectionName: "other_request" },
    { ...structuredClone(route), rootConnectionName: "other_owner" },
    { ...structuredClone(route), startPcbPortId: "original_start" },
    { ...structuredClone(route), endPcbPortId: "original_end" },
    { ...structuredClone(route), route: [
      { ...route.route[0]!, toNextSegmentType: "through_obstacle" as const },
      route.route[1]!,
    ] },
  ]
  const source = [route, structuredClone(route), ...different]
  const before = JSON.stringify(source)
  const unique = getUniqueStitchRoutes(source)
  expect(unique).toHaveLength(different.length + 1)
  expect(unique[0]).toBe(route)
  for (const distinct of different) expect(unique).toContain(distinct)
  expect(JSON.stringify(source)).toBe(before)
  expect(getUniqueStitchRoutes([])).toEqual([])
})
