import type { HighDensityRoute } from "lib/types/high-density-types";

export const createMultiRouteCrossing = (): HighDensityRoute[] => [
  {
    connectionName: "detour",
    traceThickness: 0.15,
    viaDiameter: 0.4,
    route: [
      { x: -2, y: 4, z: 0, pcb_port_id: "detour-start" },
      { x: -2, y: 3, z: 0 },
      { x: -2, y: 3, z: 1 },
      { x: -2, y: -3, z: 1 },
      { x: -2, y: -3, z: 0 },
      { x: -2, y: -4, z: 0, pcb_port_id: "detour-end" },
    ],
    vias: [
      { x: -2, y: 3 },
      { x: -2, y: -3 },
    ],
  },
  {
    connectionName: "transition-a",
    traceThickness: 0.15,
    viaDiameter: 0.4,
    route: [
      { x: 1, y: 1, z: 1, pcb_port_id: "transition-a-start" },
      { x: 0, y: 1, z: 1 },
      { x: 0, y: 1, z: 0 },
      { x: -3, y: 1, z: 0, pcb_port_id: "transition-a-end" },
    ],
    vias: [{ x: 0, y: 1 }],
  },
  {
    connectionName: "transition-b",
    traceThickness: 0.15,
    viaDiameter: 0.4,
    route: [
      { x: 1, y: -1, z: 1, pcb_port_id: "transition-b-start" },
      { x: 0, y: -1, z: 1 },
      { x: 0, y: -1, z: 0 },
      { x: -3, y: -1, z: 0, pcb_port_id: "transition-b-end" },
    ],
    vias: [{ x: 0, y: -1 }],
  },
];

export const createSameRouteMultiSectionCrossing = (): HighDensityRoute[] => [
  createMultiRouteCrossing()[0],
  {
    connectionName: "transition",
    traceThickness: 0.15,
    viaDiameter: 0.4,
    route: [
      { x: 1, y: 1, z: 1, pcb_port_id: "transition-start" },
      { x: 0, y: 1, z: 1 },
      { x: 0, y: 1, z: 0 },
      { x: -3, y: 1, z: 0 },
      { x: -3, y: 1, z: 1 },
      { x: -4, y: 1, z: 1 },
      { x: -4, y: -4, z: 1 },
      { x: 0, y: -4, z: 1 },
      { x: 0, y: -1, z: 1 },
      { x: 0, y: -1, z: 0 },
      { x: -3, y: -1, z: 0, pcb_port_id: "transition-end" },
    ],
    vias: [
      { x: 0, y: 1 },
      { x: -3, y: 1 },
      { x: 0, y: -1 },
    ],
  },
];
