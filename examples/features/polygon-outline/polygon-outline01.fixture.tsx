import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"

const simpleRouteJson: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.2,
  obstacles: [
    {
      type: "rect",
      layers: ["top", "bottom"],
      center: { x: 0, y: 0 },
      width: 2.5,
      height: 2.5,
      connectedTo: [],
    },
  ],
  connections: [
    {
      name: "conn-left-arm",
      pointsToConnect: [
        { x: -9.5, y: 9, layer: "top" },
        { x: -9.5, y: -3.5, layer: "top" },
      ],
    },
    {
      name: "conn-right-arm",
      pointsToConnect: [
        { x: 9.5, y: 9, layer: "bottom" },
        { x: 9.5, y: -3.5, layer: "bottom" },
      ],
    },
  ],
  bounds: { minX: -14, maxX: 14, minY: -14, maxY: 14 },
  outline: [
    { x: -12, y: 12 },
    { x: -12, y: -12 },
    { x: 12, y: -12 },
    { x: 12, y: 12 },
    { x: 6, y: 12 },
    { x: 6, y: -4 },
    { x: -6, y: -4 },
    { x: -6, y: 12 },
  ],
}

export default () => <AutoroutingPipelineDebugger srj={simpleRouteJson} />
