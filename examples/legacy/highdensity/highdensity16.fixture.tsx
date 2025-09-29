import { InteractiveGraphics } from "graphics-debug/react"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { combineVisualizations } from "lib/utils/combineVisualizations"
import { generateColorMapFromNodeWithPortPoints } from "lib/utils/generateColorMapFromNodeWithPortPoints"

const nodeWithPortPoints = {
  capacityMeshNodeId: "cn11470",
  portPoints: [
    { x: 105.5, y: -25, connectionName: "connectivity_net3412", z: 0 },
    { x: 106, y: -25, connectionName: "connectivity_net3434", z: 0 },
    { x: 106.5, y: -25, connectionName: "connectivity_net3995", z: 0 },
    { x: 107, y: -25, connectionName: "connectivity_net4017", z: 0 },
    {
      x: 110,
      y: -29.285714285714285,
      connectionName: "connectivity_net2125",
      z: 0,
    },
    {
      x: 110,
      y: -28.571428571428573,
      connectionName: "connectivity_net2169",
      z: 0,
    },
    {
      x: 110,
      y: -27.857142857142858,
      connectionName: "connectivity_net2213",
      z: 0,
    },
    {
      x: 110,
      y: -27.142857142857142,
      connectionName: "connectivity_net3434",
      z: 0,
    },
    {
      x: 110,
      y: -26.428571428571427,
      connectionName: "connectivity_net4006",
      z: 0,
    },
    {
      x: 110,
      y: -25.714285714285715,
      connectionName: "connectivity_net4017",
      z: 0,
    },
    {
      x: 105,
      y: -29.285714285714285,
      connectionName: "connectivity_net2125",
      z: 0,
    },
    {
      x: 105,
      y: -28.571428571428573,
      connectionName: "connectivity_net2169",
      z: 0,
    },
    {
      x: 105,
      y: -27.857142857142858,
      connectionName: "connectivity_net2213",
      z: 0,
    },
    {
      x: 105,
      y: -27.142857142857142,
      connectionName: "connectivity_net3412",
      z: 0,
    },
    {
      x: 105,
      y: -26.428571428571427,
      connectionName: "connectivity_net3995",
      z: 0,
    },
    {
      x: 105,
      y: -25.714285714285715,
      connectionName: "connectivity_net4006",
      z: 0,
    },
  ],
  center: { x: 107.5, y: -27.5 },
  width: 5,
  height: 5,
}

export default () => {
  const solver = new IntraNodeRouteSolver({
    nodeWithPortPoints,
    colorMap: generateColorMapFromNodeWithPortPoints(nodeWithPortPoints),
    hyperParameters: {},
  })

  solver.solve()

  const graphics =
    solver.solvedRoutes.length > 0 ? solver.visualize() : { lines: [] }

  if (solver.failedSubSolvers.length > 0) {
    return (
      <div>
        <div className="border p-2 m-2 text-center font-bold">
          {solver.solvedRoutes.length} / {solver.totalConnections}
        </div>
        <InteractiveGraphics
          graphics={combineVisualizations(
            solver.failedSubSolvers[0].visualize(),
            solver.visualize(),
          )}
        />
      </div>
    )
  }

  return <InteractiveGraphics graphics={graphics} />
}
