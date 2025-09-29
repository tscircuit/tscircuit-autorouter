import { InteractiveGraphics } from "graphics-debug/react"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { combineVisualizations } from "lib/utils/combineVisualizations"

const nodeWithPortPoints = {
  capacityMeshNodeId: "cn1255",
  portPoints: [
    {
      x: -16.66127472499999,
      y: -13.967746275390624,
      z: 0,
      connectionName: "source_trace_11",
    },
    {
      x: -16.66127472499999,
      y: -13.58292244296875,
      z: 0,
      connectionName: "source_trace_2",
    },
    {
      x: -16.66127472499999,
      y: -13.198098610546875,
      z: 0,
      connectionName: "source_trace_20",
    },
    {
      x: -4.346912087499987,
      y: -14.3525701078125,
      z: 0,
      connectionName: "source_trace_10",
    },
    {
      x: -4.346912087499987,
      y: -12.813274778125,
      z: 0,
      connectionName: "source_trace_13",
    },
    {
      x: -4.346912087499987,
      y: -11.273979448437501,
      z: 0,
      connectionName: "source_trace_14",
    },
    {
      x: -4.346912087499987,
      y: -9.73468411875,
      z: 0,
      connectionName: "source_trace_16",
    },
    {
      x: -4.346912087499987,
      y: -8.195388789062498,
      z: 0,
      connectionName: "source_trace_17",
    },
    {
      x: -4.346912087499987,
      y: -6.656093459374999,
      z: 0,
      connectionName: "source_trace_5",
    },
    {
      x: -4.346912087499987,
      y: -5.116798129687499,
      z: 0,
      connectionName: "source_trace_8",
    },
    {
      x: -15.54178721249999,
      y: -15.891865437500002,
      z: 0,
      connectionName: "source_trace_1",
    },
    {
      x: -14.422299699999991,
      y: -15.891865437500002,
      z: 0,
      connectionName: "source_trace_14",
    },
    {
      x: -13.30281218749999,
      y: -15.891865437500002,
      z: 0,
      connectionName: "source_trace_19",
    },
    {
      x: -12.18332467499999,
      y: -15.891865437500002,
      z: 0,
      connectionName: "source_trace_2",
    },
    {
      x: -11.06383716249999,
      y: -15.891865437500002,
      z: 0,
      connectionName: "source_trace_22",
    },
    {
      x: -9.944349649999989,
      y: -15.891865437500002,
      z: 0,
      connectionName: "source_trace_23",
    },
    {
      x: -8.824862137499988,
      y: -15.891865437500002,
      z: 0,
      connectionName: "source_trace_25",
    },
    {
      x: -7.705374624999989,
      y: -15.891865437500002,
      z: 0,
      connectionName: "source_trace_4",
    },
    {
      x: -6.585887112499988,
      y: -15.891865437500002,
      z: 0,
      connectionName: "source_trace_5",
    },
    {
      x: -5.466399599999988,
      y: -15.891865437500002,
      z: 0,
      connectionName: "source_trace_7",
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
  center: {
    x: -10.50409340624999,
    y: -9.73468411875,
  },
  width: 12.314362637500004,
  height: 12.314362637500004,
}

const colorMap = {
  source_trace_0: "hsl(0, 100%, 50%)",
  source_trace_1: "hsl(13.333333333333334, 100%, 50%)",
  source_trace_2: "hsl(26.666666666666668, 100%, 50%)",
  source_trace_3: "hsl(40, 100%, 50%)",
  source_trace_4: "hsl(53.333333333333336, 100%, 50%)",
  source_trace_5: "hsl(66.66666666666667, 100%, 50%)",
  source_trace_6: "hsl(80, 100%, 50%)",
  source_trace_7: "hsl(93.33333333333333, 100%, 50%)",
  source_trace_8: "hsl(106.66666666666667, 100%, 50%)",
  source_trace_9: "hsl(120, 100%, 50%)",
  source_trace_10: "hsl(133.33333333333334, 100%, 50%)",
  source_trace_11: "hsl(146.66666666666666, 100%, 50%)",
  source_trace_12: "hsl(160, 100%, 50%)",
  source_trace_13: "hsl(173.33333333333334, 100%, 50%)",
  source_trace_14: "hsl(186.66666666666666, 100%, 50%)",
  source_trace_15: "hsl(200, 100%, 50%)",
  source_trace_16: "hsl(213.33333333333334, 100%, 50%)",
  source_trace_17: "hsl(226.66666666666666, 100%, 50%)",
  source_trace_18: "hsl(240, 100%, 50%)",
  source_trace_19: "hsl(253.33333333333334, 100%, 50%)",
  source_trace_20: "hsl(266.6666666666667, 100%, 50%)",
  source_trace_21: "hsl(280, 100%, 50%)",
  source_trace_22: "hsl(293.3333333333333, 100%, 50%)",
  source_trace_23: "hsl(306.6666666666667, 100%, 50%)",
  source_trace_24: "hsl(320, 100%, 50%)",
  source_trace_25: "hsl(333.3333333333333, 100%, 50%)",
  source_trace_26: "hsl(346.6666666666667, 100%, 50%)",
}

export default () => {
  const solver = new IntraNodeRouteSolver({
    nodeWithPortPoints,
    colorMap,
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
