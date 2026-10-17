import { expect, test } from "bun:test"
import {
  EndpointClusterIndex,
  selectRoutesAlongEndpointPath,
} from "lib/solvers/RouteStitchingSolver/routeStitchingEndpointHelpers"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("stitching preserves an existing copper detour instead of inventing a gap", (): void => {
  const points = [
    { x: -0.4, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 1.2, z: 0 },
    { x: 0.8, y: 1.2, z: 0 },
    { x: 0.8, y: 0, z: 0 },
    { x: 1.2, y: 0, z: 0 },
  ]
  const routes: HighDensityIntraNodeRoute[] = points.slice(1).map(
    (end, index): HighDensityIntraNodeRoute => ({
      connectionName: "signal",
      traceThickness: 0.1524,
      viaDiameter: 0.2032,
      vias: [],
      route: [points[index]!, end],
      ...(index === 0 ? { startPcbPortId: "pad-a" } : {}),
      ...(index === 4 ? { endPcbPortId: "pad-b" } : {}),
    }),
  )
  const selected = selectRoutesAlongEndpointPath({
    preserveTerminalBranches: true,
    connectionName: "signal",
    hdRoutes: routes,
    start: { ...points[0]!, pcb_port_id: "pad-a" },
    end: { ...points[5]!, pcb_port_id: "pad-b" },
    endpointIndex: new EndpointClusterIndex(true),
    canStitchBetweenTerminals: (): boolean => true,
  })

  expect(selected).toHaveLength(routes.length)
  for (const route of routes) expect(selected).toContain(route)
})
