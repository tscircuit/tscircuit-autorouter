import { InteractiveGraphics } from "graphics-debug/react"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { combineVisualizations } from "lib/utils/combineVisualizations"
import { generateColorMapFromNodeWithPortPoints } from "lib/utils/generateColorMapFromNodeWithPortPoints"

const { nodeWithPortPoints } = {
  nodeWithPortPoints: {
    capacityMeshNodeId: "cn548",
    portPoints: [
      {
        x: -15.429838461249991,
        y: 21.05122247500001,
        z: 0,
        connectionName: "source_trace_1",
      },
      {
        x: -14.198402197499991,
        y: 21.05122247500001,
        z: 0,
        connectionName: "source_trace_10",
      },
      {
        x: -12.96696593374999,
        y: 21.05122247500001,
        z: 0,
        connectionName: "source_trace_13",
      },
      {
        x: -11.73552966999999,
        y: 21.05122247500001,
        z: 0,
        connectionName: "source_trace_16",
      },
      {
        x: -10.50409340624999,
        y: 21.05122247500001,
        z: 0,
        connectionName: "source_trace_17",
      },
      {
        x: -9.27265714249999,
        y: 21.05122247500001,
        z: 0,
        connectionName: "source_trace_26",
      },
      {
        x: -8.04122087874999,
        y: 21.05122247500001,
        z: 0,
        connectionName: "source_trace_4",
      },
      {
        x: -6.809784614999987,
        y: 21.05122247500001,
        z: 0,
        connectionName: "source_trace_7",
      },
      {
        x: -5.578348351249987,
        y: 21.05122247500001,
        z: 0,
        connectionName: "source_trace_8",
      },
      {
        x: -16.66127472499999,
        y: 27.824121925625008,
        z: 0,
        connectionName: "source_trace_1",
      },
      {
        x: -16.66127472499999,
        y: 28.43984005750001,
        z: 0,
        connectionName: "source_trace_10",
      },
      {
        x: -16.66127472499999,
        y: 29.05555818937501,
        z: 0,
        connectionName: "source_trace_13",
      },
      {
        x: -16.66127472499999,
        y: 29.671276321250012,
        z: 0,
        connectionName: "source_trace_16",
      },
      {
        x: -16.66127472499999,
        y: 30.28699445312501,
        z: 0,
        connectionName: "source_trace_17",
      },
      {
        x: -16.66127472499999,
        y: 30.90271258500001,
        z: 0,
        connectionName: "source_trace_26",
      },
      {
        x: -16.66127472499999,
        y: 31.518430716875013,
        z: 0,
        connectionName: "source_trace_4",
      },
      {
        x: -16.66127472499999,
        y: 32.134148848750016,
        z: 0,
        connectionName: "source_trace_7",
      },
      {
        x: -16.66127472499999,
        y: 32.749866980625015,
        z: 0,
        connectionName: "source_trace_8",
      },
    ],
    center: { x: -4.346912087499987, y: 33.365585112500014 },
    width: 24.628725275000008,
    height: 24.628725275000008,
  },
}

export default () => {
  const solver = new IntraNodeRouteSolver({
    nodeWithPortPoints,
    colorMap: generateColorMapFromNodeWithPortPoints(nodeWithPortPoints),
    hyperParameters: {
      CELL_SIZE_FACTOR: 0.5,
    },
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
