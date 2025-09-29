import { InteractiveGraphics } from "graphics-debug/react"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { combineVisualizations } from "lib/utils/combineVisualizations"
import { generateColorMapFromNodeWithPortPoints } from "lib/utils/generateColorMapFromNodeWithPortPoints"
import { useEffect, useMemo, useState } from "react"
import { doSegmentsIntersect } from "@tscircuit/math-utils"
import { getIntraNodeCrossings } from "lib/utils/getIntraNodeCrossings"

const { nodeWithPortPoints } = {
  nodeWithPortPoints: {
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
    center: { x: -10.50409340624999, y: -9.73468411875 },
    width: 12.314362637500004,
    height: 12.314362637500004,
  },
}

export default () => {
  const [shuffleSeed, setShuffleSeed] = useState(0)
  const [iterations, setIterations] = useState(0)
  const solver = useMemo(
    () =>
      new IntraNodeRouteSolver({
        nodeWithPortPoints,
        colorMap: generateColorMapFromNodeWithPortPoints(nodeWithPortPoints),
        hyperParameters: {
          FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR: 10,
          FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR: 1,
          FUTURE_CONNECTION_PROXIMITY_VD: 5,
          MISALIGNED_DIST_PENALTY_FACTOR: 10,
          VIA_PENALTY_FACTOR_2: 1,
          SHUFFLE_SEED: shuffleSeed,
        },
      }),
    [shuffleSeed],
  )

  useEffect(() => {
    const interval = setInterval(() => {
      for (let i = 0; i < 200; i++) {
        if (solver.solved || solver.failed) {
          clearInterval(interval)
          break
        }
        solver.step()
      }
      setIterations(solver.iterations)
    }, 50)
    return () => clearInterval(interval)
  }, [solver])

  const numVias = solver.solvedRoutes.reduce(
    (total, route) => total + route.vias.length,
    0,
  )

  // Count the number of crossings
  const { numSameLayerCrossings } = getIntraNodeCrossings(nodeWithPortPoints)

  return (
    <div>
      <div className="border p-2 m-2 flex font-bold justify-between">
        <div>
          {solver.solvedRoutes.length} / {solver.totalConnections}
        </div>
        <div>{iterations}</div>
      </div>
      <div className="flex items-center gap-3">
        <button
          className="border p-2 m-2"
          onClick={() => {
            setShuffleSeed(shuffleSeed + 1)
          }}
        >
          Next Seed ({shuffleSeed})
        </button>
        <div>{numVias} vias</div>
        <div>{numSameLayerCrossings} crossings</div>
        <div>
          {(numVias / numSameLayerCrossings).toFixed(2)} vias per crossing
        </div>
      </div>
      <InteractiveGraphics
        graphics={combineVisualizations(
          ...(solver.failedSubSolvers?.[0]
            ? [solver.failedSubSolvers[0].visualize()]
            : []),
          solver.visualize(),
        )}
      />
    </div>
  )
}
