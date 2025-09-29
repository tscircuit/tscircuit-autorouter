import { InteractiveGraphics } from "graphics-debug/react"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { combineVisualizations } from "lib/utils/combineVisualizations"

const nodeWithPortPoints = {
  capacityMeshNodeId: "cn1386",
  portPoints: [
    {
      x: -16.66127472499999,
      y: -21.664222923828127,
      connectionName: "source_trace_14",
      z: 0,
    },
    {
      x: -16.66127472499999,
      y: -21.279399091406255,
      connectionName: "source_trace_23",
      z: 0,
    },
    {
      x: -16.66127472499999,
      y: -20.894575258984382,
      connectionName: "source_trace_5",
      z: 0,
    },
    {
      x: -18.970217719531245,
      y: -21.664222923828127,
      z: 0,
      connectionName: "source_trace_14",
    },
    {
      x: -18.970217719531245,
      z: 0,
      y: -21.279399091406255,
      connectionName: "source_trace_23",
    },
    {
      x: -18.970217719531245,
      y: -20.894575258984382,
      z: 0,
      connectionName: "source_trace_5",
    },
  ],
  center: { x: -17.430922389843744, y: -21.279399091406255 },
  width: 1.5392953296875005,
  height: 1.5392953296875005,
}

export default () => {
  const solver = new IntraNodeRouteSolver({
    nodeWithPortPoints,
  })

  solver.solve()

  const graphics =
    solver.solvedRoutes.length > 0 ? solver.visualize() : { lines: [] }

  if (solver.failedSubSolvers.length > 0) {
    return (
      <InteractiveGraphics
        graphics={combineVisualizations(
          solver.failedSubSolvers[0].visualize(),
          solver.visualize(),
        )}
      />
    )
  }

  return <InteractiveGraphics graphics={graphics} />
}
