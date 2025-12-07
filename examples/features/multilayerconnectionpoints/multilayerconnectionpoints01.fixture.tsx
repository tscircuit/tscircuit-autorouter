import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"

export const simpleRouteJson: SimpleRouteJson = {
  bounds: {
    minX: -8,
    maxX: 8,
    minY: -4,
    maxY: 4,
  },
  obstacles: [
    {
      type: "rect",
      layers: ["top", "bottom"],
      center: { x: -4, y: 0 },
      width: 2,
      height: 2,
      connectedTo: ["left_pad"],
    },
    {
      type: "rect",
      layers: ["bottom"],
      center: { x: 4, y: 0 },
      width: 2,
      height: 2,
      connectedTo: ["right_pad"],
    },
  ],
  connections: [
    {
      name: "LEFT_TO_RIGHT",
      pointsToConnect: [
        {
          x: -4,
          y: 0,
          layers: ["top", "bottom"],
          pointId: "left_pad",
        },
        { x: 4, y: 0, layer: "bottom", pointId: "right_pad" },
      ],
    },
  ],
  layerCount: 2,
  minTraceWidth: 0.2,
}

export default () => <AutoroutingPipelineDebugger srj={simpleRouteJson} />
