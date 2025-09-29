import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import { SimpleRouteJson } from "lib/types"

const simpleRouteJson: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.2,
  obstacles: [
    // Create a rectangular obstacle in the center
    {
      type: "rect",
      layers: ["top", "bottom"],
      center: { x: 0, y: 0 },
      width: 5,
      height: 5,
      connectedTo: [],
    },
  ],
  connections: [
    // Create a connection that needs to go around the obstacle
    {
      name: "conn1",
      pointsToConnect: [
        { x: -10, y: 5, layer: "top" },
        { x: 10, y: 5, layer: "top" },
      ],
    },
  ],
  bounds: { minX: -15, maxX: 15, minY: -15, maxY: 15 },
}

export default () => {
  return <AutoroutingPipelineDebugger srj={simpleRouteJson} />
}
