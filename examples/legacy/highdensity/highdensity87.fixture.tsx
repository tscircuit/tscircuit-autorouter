import { HyperHighDensityDebugger } from "lib/testing/HyperHighDensityDebugger"

const hd = {
  nodeId: "cmn_16",
  capacityMeshNode: null,
  nodeWithPortPoints: {
    capacityMeshNodeId: "cmn_16",
    portPoints: [
      {
        x: -1.2700000000000002,
        y: 3.01,
        z: 0,
        connectionName: "source_net_1",
      },
      {
        x: -0.4700000000000002,
        y: 2.8075,
        z: 0,
        connectionName: "source_net_2",
      },
      {
        x: -0.4700000000000002,
        y: 2.3375000000000004,
        z: 1,
        connectionName: "source_net_1",
      },
      {
        x: -2.0700000000000003,
        y: 2.54,
        z: 0,
        connectionName: "source_net_2",
      },
    ],
    center: {
      x: -1.2700000000000002,
      y: 2.54,
    },
    width: 1.6,
    height: 0.9399999999999995,
  },
}

export default () => {
  return <HyperHighDensityDebugger nodeWithPortPoints={hd.nodeWithPortPoints} />
}
