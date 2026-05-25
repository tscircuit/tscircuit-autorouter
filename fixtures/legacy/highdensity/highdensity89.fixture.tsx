import { createPortPointPairsFromPortPoints } from "lib/utils/getPortPointsFromNodeWithPortPoints"
import { HighDensityDebugger } from "lib/testing/HighDensityDebugger"
const hd = {
  nodeId: "cmn_2",
  capacityMeshNode: null,
  nodeWithPortPoints: {
    capacityMeshNodeId: "cmn_2",
    portPointsInPairs: createPortPointPairsFromPortPoints([
      {
        x: -2.6499999999999995,
        y: 6.985,
        z: 0,
        connectionName: "source_trace_0",
      },
      {
        x: -2.6499999999999986,
        y: -4.476206896551725,
        z: 3,
        connectionName: "source_trace_13",
      },
      {
        x: -20.75,
        y: 13.97,
        z: 1,
        connectionName: "source_trace_13",
      },
      {
        x: -20.75,
        y: 11.429999999999998,
        z: 1,
        connectionName: "source_trace_15",
      },
      {
        x: -2.6499999999999995,
        y: 1.9050000000000002,
        z: 0,
        connectionName: "source_trace_4",
      },
      {
        x: -2.6499999999999986,
        y: 1.141379310344828,
        z: 3,
        connectionName: "source_trace_4",
      },
      {
        x: -20.75,
        y: 8.889999999999999,
        z: 1,
        connectionName: "source_trace_17",
      },
      {
        x: -2.6499999999999995,
        y: 0.6350000000000007,
        z: 0,
        connectionName: "source_trace_5",
      },
      {
        x: -2.6499999999999995,
        y: -1.905,
        z: 0,
        connectionName: "source_trace_7",
      },
      {
        x: -2.6499999999999995,
        y: -4.444999999999999,
        z: 0,
        connectionName: "source_trace_9",
      },
      {
        x: -20.75,
        y: -13.97,
        z: 1,
        connectionName: "source_trace_12",
      },
      {
        x: -20.75,
        y: -11.43,
        z: 0,
        connectionName: "source_trace_14",
      },
      {
        x: -20.75,
        y: -8.89,
        z: 0,
        connectionName: "source_trace_16",
      },
      {
        x: -2.6499999999999986,
        y: 0.6306896551724146,
        z: 3,
        connectionName: "source_trace_18",
      },
      {
        x: -20.75,
        y: -6.3500000000000005,
        z: 3,
        connectionName: "source_trace_18",
      },
      {
        x: -2.6499999999999986,
        y: 2.54,
        z: 0,
        connectionName: "source_trace_20",
      },
      {
        x: -20.75,
        y: -3.8100000000000005,
        z: 0,
        connectionName: "source_trace_20",
      },
      {
        x: -2.6499999999999986,
        y: 4.205517241379312,
        z: 3,
        connectionName: "source_trace_22",
      },
      {
        x: -20.75,
        y: -1.2700000000000014,
        z: 3,
        connectionName: "source_trace_22",
      },
      {
        x: -2.6499999999999986,
        y: 5.226896551724138,
        z: 3,
        connectionName: "source_trace_23",
      },
      {
        x: -20.75,
        y: 1.2699999999999996,
        z: 3,
        connectionName: "source_trace_23",
      },
      {
        x: -2.6499999999999986,
        y: 1.2700000000000005,
        z: 0,
        connectionName: "source_trace_19",
      },
      {
        x: -20.75,
        y: 6.35,
        z: 0,
        connectionName: "source_trace_19",
      },
      {
        x: -2.6499999999999986,
        y: 3.6948275862068964,
        z: 3,
        connectionName: "source_trace_21",
      },
      {
        x: -20.75,
        y: 3.8100000000000005,
        z: 3,
        connectionName: "source_trace_21",
      },
      {
        x: -2.6499999999999986,
        y: -18.89,
        z: 1,
        connectionName: "source_trace_0",
      },
      {
        x: -2.6499999999999986,
        y: -17.78,
        z: 1,
        connectionName: "source_trace_12",
      },
      {
        x: -2.6499999999999986,
        y: -16.669999999999998,
        z: 0,
        connectionName: "source_trace_14",
      },
      {
        x: -2.6499999999999986,
        y: -13.34,
        z: 0,
        connectionName: "source_trace_15",
      },
      {
        x: -2.6499999999999986,
        y: -14.45,
        z: 0,
        connectionName: "source_trace_16",
      },
      {
        x: -2.6499999999999986,
        y: -15.559999999999999,
        z: 0,
        connectionName: "source_trace_17",
      },
      {
        x: -2.6499999999999986,
        y: -10.009999999999998,
        z: 0,
        connectionName: "source_trace_5",
      },
      {
        x: -2.6499999999999986,
        y: -11.12,
        z: 0,
        connectionName: "source_trace_7",
      },
      {
        x: -2.6499999999999986,
        y: -12.23,
        z: 0,
        connectionName: "source_trace_9",
      },
    ]),
    center: {
      x: -11.7,
      y: 0,
    },
    width: 18.1,
    height: 40,
  },
}
export default () => {
  return <HighDensityDebugger nodeWithPortPoints={hd.nodeWithPortPoints} />
}
