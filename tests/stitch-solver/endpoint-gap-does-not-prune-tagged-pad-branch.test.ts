import { expect, test } from "bun:test"
import {
  EndpointClusterIndex,
  selectRoutesAlongEndpointPath,
} from "lib/solvers/RouteStitchingSolver/routeStitchingEndpointHelpers"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("an endpoint graph shortcut does not erase the real terminal branch", (): void => {
  const routes: HighDensityIntraNodeRoute[] = [
    [0, 1],
    [1, 2],
    [2, 2.5],
    [2.5, 3],
  ].map(([start, end], index) => ({
    connectionName: "signal",
    traceThickness: 0.1524,
    viaDiameter: 0.2032,
    vias: [],
    route: [
      { x: start!, y: 0, z: 0 },
      { x: end!, y: 0, z: 0 },
    ],
    ...(index === 0 ? { startPcbPortId: "pad-a" } : {}),
    ...(index === 3 ? { endPcbPortId: "pad-b" } : {}),
  }))
  const selected = selectRoutesAlongEndpointPath({
    preserveTerminalBranches: true,
    connectionName: "signal",
    hdRoutes: routes,
    start: { x: 0, y: 0, z: 0, pcb_port_id: "pad-a" },
    end: { x: 3, y: 0, z: 0, pcb_port_id: "pad-b" },
    endpointIndex: new EndpointClusterIndex(true),
    canStitchBetweenTerminals: () => true,
  })
  expect(selected).toContain(routes[0]!)
  expect(selected).toContain(routes[3]!)
})
