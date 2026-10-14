import { expect, test } from "bun:test"
import { removeVerifiedInternalTerminalTags } from "lib/solvers/RouteStitchingSolver/removeVerifiedInternalTerminalTags"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("shared-root stitching preserves invalid terminal identities", () => {
  const route: HighDensityIntraNodeRoute = {
    connectionName: "root_mst0",
    startPcbPortId: "unknown_terminal",
    endPcbPortId: "pcb_port_shared",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
    vias: [],
  }
  const routes = removeVerifiedInternalTerminalTags({
    bridgeConnectionNamesByPcbPortId: new Map([
      ["pcb_port_shared", new Set(["root_mst0"])],
    ]),
    hdRoutes: [route],
    start: { x: 0, y: 0, z: 0, pcb_port_id: "pcb_port_start" },
    end: { x: 2, y: 0, z: 0, pcb_port_id: "pcb_port_end" },
  })

  expect(routes[0]?.endPcbPortId).toBeUndefined()
  expect(() =>
    new SingleHighDensityRouteStitchSolver3({
      connectionName: "root_mst1",
      hdRoutes: routes,
      start: { x: 0, y: 0, z: 0, pcb_port_id: "pcb_port_start" },
      end: { x: 2, y: 0, z: 0, pcb_port_id: "pcb_port_end" },
      preserveTerminalPcbPortIds: true,
      isStitchSegmentClear: () => true,
      stitchClearanceMode: "require_clear",
    }),
  ).toThrow('found unknown PCB terminal "unknown_terminal"')
})
