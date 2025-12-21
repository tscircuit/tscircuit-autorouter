import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import { AssignableAutoroutingPipeline1Solver } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline1/AssignableAutoroutingPipeline1Solver"
import { SimpleRouteJson } from "lib/types"

export const simpleRouteJson: SimpleRouteJson = {
  bounds: {
    minX: -5,
    maxX: 5,
    minY: -5,
    maxY: 5,
  },
  obstacles: [
    {
      // @ts-ignore
      type: "oval",
      layers: ["top"],
      center: {
        x: 0,
        y: 4,
      },
      width: 1.2,
      height: 1.2,
      connectedTo: [
        "pcb_smtpad_0",
        "connectivity_net0",
        "source_trace_0",
        "source_port_0",
        "source_port_2",
        "pcb_smtpad_0",
        "pcb_port_0",
        "pcb_port_2",
      ],
    },
    {
      // @ts-ignore
      type: "oval",
      layers: ["bottom"],
      center: {
        x: 0,
        y: -4,
      },
      width: 1.2,
      height: 1.2,
      connectedTo: [
        "pcb_smtpad_1",
        "connectivity_net3",
        "source_trace_1",
        "source_port_3",
        "source_port_1",
        "pcb_smtpad_1",
        "pcb_port_1",
        "pcb_port_3",
      ],
    },
    {
      type: "rect",
      layers: ["bottom", "top"],
      center: {
        x: 0,
        y: 0,
      },
      connectedTo: [],
      width: 0.6,
      height: 0.6,
      netIsAssignable: true,
    },
  ],
  connections: [
    {
      name: "source_trace_0",
      // @ts-ignore
      source_trace_id: "source_trace_0",
      pointsToConnect: [
        {
          x: 0,
          y: 4,
          layer: "top",
          pointId: "pcb_port_0",
          pcb_port_id: "pcb_port_0",
        },
        {
          x: 0,
          y: 0,
          layer: "top",
          pointId: "pcb_port_2",
          pcb_port_id: "pcb_port_2",
        },
      ],
    },
    {
      name: "source_trace_1",
      // @ts-ignore
      source_trace_id: "source_trace_1",
      pointsToConnect: [
        {
          x: 0,
          y: 0,
          layer: "bottom",
          pointId: "pcb_port_3",
          pcb_port_id: "pcb_port_3",
        },
        {
          x: 0,
          y: -4,
          layer: "bottom",
          pointId: "pcb_port_1",
          pcb_port_id: "pcb_port_1",
        },
      ],
    },
  ],
  layerCount: 2,
  minTraceWidth: 0.15,
}

export default () => (
  <AutoroutingPipelineDebugger
    createSolver={(srj, opts) =>
      new AssignableAutoroutingPipeline1Solver(srj, opts)
    }
    srj={simpleRouteJson as any}
  />
)
