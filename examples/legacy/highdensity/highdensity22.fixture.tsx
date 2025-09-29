import { HyperHighDensityDebugger } from "lib/testing/HyperHighDensityDebugger"

export default () => (
  <HyperHighDensityDebugger
    {...{
      nodeWithPortPoints: {
        capacityMeshNodeId: "cn3304",
        portPoints: [
          {
            x: -107.5,
            y: -9.296875,
            z: 0,
            connectionName: "connectivity_net211",
          },
          {
            x: -108.046875,
            y: -8.75,
            z: 1,
            connectionName: "connectivity_net178",
          },
          {
            x: -108.59375,
            y: -9.296875,
            z: 1,
            connectionName: "connectivity_net211",
          },
          {
            x: -108.3203125,
            y: -9.84375,
            z: 0,
            connectionName: "connectivity_net178",
          },
        ],
        center: { x: -108.046875, y: -9.296875 },
        width: 1.09375,
        height: 1.09375,
      },
    }}
  />
)
