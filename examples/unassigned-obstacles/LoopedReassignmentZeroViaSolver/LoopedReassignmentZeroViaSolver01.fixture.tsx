import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { LoopedReassignmentZeroViaSolver } from "lib/solvers/LoopedReassignmentZeroViaSolver/LoopedReassignmentZeroViaSolver"
import { SimpleRouteJson } from "lib/types"

export const simpleRouteJson: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.15,
  obstacles: [
    // Leftmost obstacle - only on top layer
    {
      type: "rect",
      center: { x: -4, y: 0 },
      width: 2,
      height: 2,
      layers: ["top"],
      connectedTo: ["left_obstacle"],
    },
    // Middle obstacle - on both layers, assignable
    {
      type: "rect",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      layers: ["top", "bottom"],
      connectedTo: [],
      netIsAssignable: true,
    },
    // Rightmost obstacle - only on bottom layer
    {
      type: "rect",
      center: { x: 4, y: 0 },
      width: 2,
      height: 2,
      layers: ["bottom"],
      connectedTo: ["right_obstacle"],
    },
  ],
  connections: [
    {
      name: "net1",
      pointsToConnect: [
        { x: -4, y: 0, layer: "top", pcb_port_id: "left_obstacle" },
        { x: 4, y: 0, layer: "bottom", pcb_port_id: "right_obstacle" },
      ],
    },
  ],
  bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
}

export default () => {
  return (
    <GenericSolverDebugger
      createSolver={() =>
        new LoopedReassignmentZeroViaSolver(simpleRouteJson, {})
      }
      showDeepestVisualizationInitial={true}
    />
  )
}
