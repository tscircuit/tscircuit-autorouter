import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

const connectionName = "source_net_altium_pcb_3_mst0"
const start = {
  x: 197.98394489999998,
  y: 123.16207269999998,
  z: 7,
  pcb_port_id: "pcb_port_altium_8622",
}
const end = {
  x: 197.98440972,
  y: 123.16207269999998,
  z: 0,
  pcb_port_id: "pcb_port_altium_7312",
}
const hdRoutes: HighDensityIntraNodeRoute[] = [
  {
    connectionName,
    rootConnectionName: "source_net_altium_pcb_3",
    endPcbPortId: "pcb_port_altium_7312",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 197.984, y: 122.552, z: 0 },
      { x: 197.984, y: 123.162, z: 0 },
    ],
    vias: [],
  },
  {
    connectionName,
    rootConnectionName: "source_net_altium_pcb_3",
    startPcbPortId: "pcb_port_altium_8622",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 197.984, y: 123.162, z: 7 },
      { x: 197.975, y: 123.15, z: 7 },
      { x: 197.975, y: 123.1, z: 7 },
      { x: 197.975, y: 123.05, z: 7 },
      { x: 197.975, y: 123, z: 7 },
      { x: 197.975, y: 122.95, z: 7 },
      { x: 197.975, y: 122.9, z: 7 },
      { x: 197.975, y: 122.85, z: 7 },
      { x: 197.975, y: 122.801, z: 7 },
      { x: 197.975, y: 122.752, z: 7 },
      { x: 197.975, y: 122.705, z: 7 },
      { x: 197.975, y: 122.661, z: 7 },
      { x: 197.975, y: 122.6, z: 7 },
      { x: 197.984, y: 122.552, z: 7 },
    ],
    vias: [],
  },
  {
    connectionName,
    rootConnectionName: "source_net_altium_pcb_3",
    startPcbPortId: "pcb_port_altium_7314",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 197.984, y: 122.552, z: 7 },
      { x: 198.067, y: 121.999, z: 7 },
      { x: 198.067, y: 121.999, z: 0 },
      { x: 197.984, y: 122.552, z: 0 },
    ],
    vias: [{ x: 198.067, y: 121.999 }],
  },
]

const createSolver = ({
  hdRoutes,
  preserveTerminalPcbPortIds,
}: {
  hdRoutes: HighDensityIntraNodeRoute[]
  preserveTerminalPcbPortIds: boolean
}) =>
  new SingleHighDensityRouteStitchSolver3({
    connectionName,
    start,
    end,
    hdRoutes,
    preserveTerminalPcbPortIds,
    isStitchSegmentClear: () => true,
    stitchClearanceMode: "prefer_clear",
  })

test("PMP22650 sibling terminal identity prevents route stitching", () => {
  expect(() =>
    createSolver({ hdRoutes, preserveTerminalPcbPortIds: true }),
  ).toThrow('found unknown PCB terminal "pcb_port_altium_7314"')

  const visualizationHdRoutes = hdRoutes.map((route) => ({
    ...route,
    startPcbPortId: undefined,
    endPcbPortId: undefined,
  }))
  const reproSolver = createSolver({
    hdRoutes: visualizationHdRoutes,
    preserveTerminalPcbPortIds: false,
  })
  const reproSvg = getSvgFromGraphicsObject(reproSolver.visualize(), {
    backgroundColor: "#0d1117",
    svgWidth: 800,
    svgHeight: 500,
  })

  expect(reproSvg).toMatchSvgSnapshot(import.meta.path)
})
