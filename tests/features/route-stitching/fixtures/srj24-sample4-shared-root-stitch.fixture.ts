import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

const TARGET_CONNECTION = "source_trace_3__source_net_3_mst24"
const ROOT_CONNECTION = "source_trace_3"

const createRoute = (
  connectionName: string,
  route: HighDensityIntraNodeRoute["route"],
  terminalIds: {
    startPcbPortId?: string
    endPcbPortId?: string
  } = {},
): HighDensityIntraNodeRoute => ({
  connectionName,
  rootConnectionName: ROOT_CONNECTION,
  route,
  vias: [],
  jumpers: [],
  traceThickness: 0.1,
  viaDiameter: 0.3,
  ...terminalIds,
})

export const srj24Sample4SharedRootStitchFixture = {
  connectionName: TARGET_CONNECTION,
  start: {
    x: -2.8,
    y: -6.15,
    z: 0,
    pcb_port_id: "pcb_port_309",
  },
  end: {
    x: -2.63,
    y: -5.825,
    z: 5,
    pcb_port_id: "pcb_port_775",
  },
  hdRoutes: [
    createRoute(
      TARGET_CONNECTION,
      [
        { x: -2.8, y: -6.15, z: 0 },
        { x: -2, y: -6.15, z: 0 },
        { x: -2, y: -6.15, z: 5 },
      ],
      { startPcbPortId: "pcb_port_309" },
    ),
    createRoute(
      "source_trace_3__source_net_3_mst6",
      [
        { x: -2, y: -6.15, z: 5 },
        { x: -0.68, y: -4.85, z: 5 },
      ],
      { endPcbPortId: "pcb_port_953" },
    ),
    createRoute(
      "source_trace_3__source_net_3_mst61",
      [
        { x: -0.68, y: -4.85, z: 5 },
        { x: -1.5, y: -5.2, z: 5 },
      ],
      { startPcbPortId: "pcb_port_953" },
    ),
    createRoute(
      TARGET_CONNECTION,
      [
        { x: -1.5, y: -5.2, z: 5 },
        { x: -2.63, y: -5.825, z: 5 },
      ],
      { endPcbPortId: "pcb_port_775" },
    ),
  ],
} satisfies {
  connectionName: string
  start: { x: number; y: number; z: number; pcb_port_id: string }
  end: { x: number; y: number; z: number; pcb_port_id: string }
  hdRoutes: HighDensityIntraNodeRoute[]
}
