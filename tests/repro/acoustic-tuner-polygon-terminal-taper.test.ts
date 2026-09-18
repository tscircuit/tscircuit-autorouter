import { expect, test } from "bun:test"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

type MicrophonePadSlice = {
  padId: string
  portId: string
  x: number
  y: number
  width: number
}

const MIN_TRACE_WIDTH = 0.15
const GROUND_TRACE_WIDTH = 0.5

// Exact rectangular approximations of two curved MSM381ACB026 ground lands
// from @tsci/gokul.acoustic-guitar-tuner@1.0.10.
const microphonePadSlices: MicrophonePadSlice[] = [
  {
    padId: "pcb_smtpad_22",
    portId: "pcb_port_24",
    x: -16.309360230512787,
    y: 2.1501268,
    width: 0.2945887561395786,
  },
  {
    padId: "pcb_smtpad_22",
    portId: "pcb_port_24",
    x: -16.27522596162683,
    y: 2.2501268,
    width: 0.3114170504621505,
  },
  {
    padId: "pcb_smtpad_22",
    portId: "pcb_port_24",
    x: -16.21718269011017,
    y: 2.3501268,
    width: 0.345535664712326,
  },
  {
    padId: "pcb_smtpad_22",
    portId: "pcb_port_24",
    x: -16.118439246368077,
    y: 2.4501268,
    width: 0.425323199428318,
  },
  {
    padId: "pcb_smtpad_22",
    portId: "pcb_port_24",
    x: -16.01667864028144,
    y: 2.5501268,
    width: 0.4641444805628847,
  },
  {
    padId: "pcb_smtpad_22",
    portId: "pcb_port_24",
    x: -15.957103968044692,
    y: 2.6501268000000002,
    width: 0.3449951360893859,
  },
  {
    padId: "pcb_smtpad_22",
    portId: "pcb_port_24",
    x: -15.853728881034481,
    y: 2.7501268000000003,
    width: 0.1382449620689652,
  },
  {
    padId: "pcb_smtpad_23",
    portId: "pcb_port_25",
    x: -15.059790886131323,
    y: 2.1499743999999996,
    width: 0.29457284482441537,
  },
  {
    padId: "pcb_smtpad_23",
    portId: "pcb_port_25",
    x: -15.093909076189377,
    y: 2.2499743999999997,
    width: 0.31139593235205076,
  },
  {
    padId: "pcb_smtpad_23",
    portId: "pcb_port_25",
    x: -15.151949703231496,
    y: 2.3499744,
    width: 0.34546003114384405,
  },
  {
    padId: "pcb_smtpad_23",
    portId: "pcb_port_25",
    x: -15.250661415005332,
    y: 2.4499744,
    width: 0.4252193879625672,
  },
  {
    padId: "pcb_smtpad_23",
    portId: "pcb_port_25",
    x: -15.35248701125791,
    y: 2.5499744,
    width: 0.46414848161872513,
  },
  {
    padId: "pcb_smtpad_23",
    portId: "pcb_port_25",
    x: -15.412084608759713,
    y: 2.6499744,
    width: 0.3449708058863177,
  },
  {
    padId: "pcb_smtpad_23",
    portId: "pcb_port_25",
    x: -15.515464651186477,
    y: 2.7499744,
    width: 0.13822824030398806,
  },
]

test("acoustic tuner polygon terminals taper below minTraceWidth", (): void => {
  const obstacles: Obstacle[] = microphonePadSlices.map((slice) => ({
    type: "rect",
    layers: ["top"],
    center: { x: slice.x, y: slice.y },
    width: slice.width,
    height: 0.1,
    connectedTo: ["source_net_0", slice.padId, slice.portId],
    componentId: "pcb_component_8",
    circuitJsonMetadata: {
      pcb_smtpad_id: slice.padId,
      pcb_port_id: slice.portId,
    },
  }))
  const route: HighDensityRoute = {
    connectionName: "source_net_0",
    traceThickness: GROUND_TRACE_WIDTH,
    viaDiameter: 0.6,
    vias: [],
    route: [
      { x: -16.1245981, y: 2.4401312, z: 0, pcb_port_id: "pcb_port_24" },
      { x: -15.244577, y: 2.4399788, z: 0, pcb_port_id: "pcb_port_25" },
    ],
  }
  const solver = new TraceWidthSolver({
    hdRoutes: [route],
    connection: [
      {
        name: "source_net_0",
        nominalTraceWidth: GROUND_TRACE_WIDTH,
        pointsToConnect: [],
      },
    ],
    obstacles,
    minTraceWidth: MIN_TRACE_WIDTH,
    obstacleMargin: 0.15,
    layerCount: 2,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  const taperedRoute = solver.getHdRoutesWithWidths()[0]!
  const emittedWidths = taperedRoute.route.map(
    (point) => point.traceThickness ?? taperedRoute.traceThickness,
  )
  const terminalWidths = [emittedWidths[0]!, emittedWidths.at(-1)!]
  expect(taperedRoute.traceThickness).toBe(GROUND_TRACE_WIDTH)
  expect(terminalWidths.every((width) => width < MIN_TRACE_WIDTH)).toBe(true)
  expect(Math.min(...terminalWidths)).toBeCloseTo(0.1, 3)
})
