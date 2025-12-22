import { AssignableAutoroutingPipeline1Solver } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline1/AssignableAutoroutingPipeline1Solver"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"

export const simpleRouteJson: SimpleRouteJson = {
  bounds: {
    minX: -12,
    maxX: 12,
    minY: -6,
    maxY: 6,
  },
  obstacles: [
    {
      type: "rect",
      layers: ["top"],
      center: { x: -6, y: 0 },
      width: 1,
      height: 1,
      connectedTo: ["pad_a"],
    },
    {
      type: "rect",
      layers: ["top"],
      center: { x: -2, y: 0 },
      width: 1,
      height: 1,
      connectedTo: [],
      netIsAssignable: true,
      offBoardConnectsTo: ["BC_NET"],
    },
    {
      type: "rect",
      layers: ["top"],
      center: { x: 2, y: 0 },
      width: 1,
      height: 1,
      connectedTo: [],
      netIsAssignable: true,
      offBoardConnectsTo: ["BC_NET"],
    },
    {
      type: "rect",
      layers: ["top"],
      center: { x: 6, y: 0 },
      width: 1,
      height: 1,
      connectedTo: ["pad_d"],
    },
  ],
  connections: [
    {
      name: "AD_NET",
      pointsToConnect: [
        { x: -6, y: 0, layer: "top", pointId: "pad_a" },
        { x: 6, y: 0, layer: "top", pointId: "pad_d" },
      ],
    },
  ],
  layerCount: 2,
  minTraceWidth: 0.2,
}

export default () => <AutoroutingPipelineDebugger srj={simpleRouteJson} />
