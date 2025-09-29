import { InteractiveGraphics } from "graphics-debug/react"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { combineVisualizations } from "lib/utils/combineVisualizations"
import { generateColorMapFromNodeWithPortPoints } from "lib/utils/generateColorMapFromNodeWithPortPoints"

const { nodeWithPortPoints } = {
  nodeWithPortPoints: {
    capacityMeshNodeId: "cn601",
    portPoints: [
      {
        x: -4.346912087499987,
        y: 3.8111147825000047,
        z: 0,
        connectionName: "source_trace_11",
      },
      {
        x: -4.346912087499987,
        y: 5.042551046250005,
        z: 0,
        connectionName: "source_trace_19",
      },
      {
        x: -4.346912087499987,
        y: 6.273987310000005,
        z: 0,
        connectionName: "source_trace_20",
      },
      {
        x: -4.346912087499987,
        y: 7.505423573750006,
        z: 0,
        connectionName: "source_trace_23",
      },
      {
        x: -15.54178721249999,
        y: 8.736859837500006,
        z: 0,
        connectionName: "source_trace_1",
      },
      {
        x: -14.422299699999991,
        y: 8.736859837500006,
        z: 0,
        connectionName: "source_trace_10",
      },
      {
        x: -13.30281218749999,
        y: 8.736859837500006,
        z: 0,
        connectionName: "source_trace_13",
      },
      {
        x: -12.18332467499999,
        y: 8.736859837500006,
        z: 0,
        connectionName: "source_trace_16",
      },
      {
        x: -11.06383716249999,
        y: 8.736859837500006,
        z: 0,
        connectionName: "source_trace_17",
      },
      {
        x: -9.944349649999989,
        y: 8.736859837500006,
        z: 0,
        connectionName: "source_trace_22",
      },
      {
        x: -8.824862137499988,
        y: 8.736859837500006,
        z: 0,
        connectionName: "source_trace_25",
      },
      {
        x: -7.705374624999989,
        y: 8.736859837500006,
        z: 0,
        connectionName: "source_trace_4",
      },
      {
        x: -6.585887112499988,
        y: 8.736859837500006,
        z: 0,
        connectionName: "source_trace_7",
      },
      {
        x: -5.466399599999988,
        y: 8.736859837500006,
        z: 0,
        connectionName: "source_trace_8",
      },
      {
        x: -15.840317215833325,
        y: -3.5775027999999978,
        z: 0,
        connectionName: "source_trace_1",
      },
      {
        x: -15.019359706666657,
        y: -3.5775027999999978,
        z: 0,
        connectionName: "source_trace_10",
      },
      {
        x: -14.198402197499991,
        y: -3.5775027999999978,
        z: 0,
        connectionName: "source_trace_11",
      },
      {
        x: -13.377444688333323,
        y: -3.5775027999999978,
        z: 0,
        connectionName: "source_trace_13",
      },
      {
        x: -12.556487179166657,
        y: -3.5775027999999978,
        z: 0,
        connectionName: "source_trace_16",
      },
      {
        x: -11.73552966999999,
        y: -3.5775027999999978,
        z: 0,
        connectionName: "source_trace_17",
      },
      {
        x: -10.914572160833323,
        y: -3.5775027999999978,
        z: 0,
        connectionName: "source_trace_19",
      },
      {
        x: -10.093614651666655,
        y: -3.5775027999999978,
        z: 0,
        connectionName: "source_trace_20",
      },
      {
        x: -9.27265714249999,
        y: -3.5775027999999978,
        z: 0,
        connectionName: "source_trace_22",
      },
      {
        x: -8.451699633333323,
        y: -3.5775027999999978,
        z: 0,
        connectionName: "source_trace_23",
      },
      {
        x: -7.630742124166655,
        y: -3.5775027999999978,
        z: 0,
        connectionName: "source_trace_25",
      },
      {
        x: -6.809784614999987,
        y: -3.5775027999999978,
        z: 0,
        connectionName: "source_trace_4",
      },
      {
        x: -5.988827105833321,
        y: -3.5775027999999978,
        z: 0,
        connectionName: "source_trace_7",
      },
      {
        x: -5.1678695966666535,
        y: -3.5775027999999978,
        z: 0,
        connectionName: "source_trace_8",
      },
    ],
    center: { x: -10.50409340624999, y: 2.579678518750004 },
    width: 12.314362637500004,
    height: 12.314362637500004,
  },
}

export default () => {
  const solver = new IntraNodeRouteSolver({
    nodeWithPortPoints,
    colorMap: generateColorMapFromNodeWithPortPoints(nodeWithPortPoints),
    hyperParameters: {
      SHUFFLE_SEED: 1,
    },
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
