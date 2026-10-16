import type { HighDensityRoute } from "lib/types/high-density-types"

export const createSharedTerminalViaRoutes = (): HighDensityRoute[] => [
  {
    connectionName: "branch-a",
    rootConnectionName: "net",
    traceThickness: 0.15,
    viaDiameter: 0.5,
    route: [
      { x: 0, y: 0, z: 0, pcb_port_id: "shared" },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 0, z: 1 },
      { x: 4, y: 0, z: 1, pcb_port_id: "end-a" },
    ],
    vias: [{ x: 1, y: 0 }],
  },
  {
    connectionName: "branch-b",
    rootConnectionName: "net",
    traceThickness: 0.15,
    viaDiameter: 0.5,
    route: [
      { x: 4, y: 2, z: 1, pcb_port_id: "end-b" },
      { x: 2, y: 1, z: 1 },
      { x: 2, y: 1, z: 0 },
      { x: 0, y: 0, z: 0, pcb_port_id: "shared" },
    ],
    vias: [{ x: 2, y: 1 }],
  },
]
