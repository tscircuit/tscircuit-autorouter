import { HighDensityDebugger } from "lib/testing/HighDensityDebugger"

export default () => (
  <HighDensityDebugger
    {...{
      nodeWithPortPoints: {
        capacityMeshNodeId: "cn4870",
        portPoints: [
          {
            x: -31.2890625,
            y: -2.8125,
            connectionName: "connectivity_net424",
            z: 0,
          },
          {
            x: -30.9375,
            y: -2.109375,
            connectionName: "connectivity_net415",
            z: 0,
          },
          {
            x: -32.34375,
            y: -2.34375,
            connectionName: "connectivity_net415",
            z: 0,
          },
          {
            x: -32.34375,
            y: -1.875,
            connectionName: "connectivity_net424",
            z: 0,
          },
        ],
        center: { x: -31.640625, y: -2.109375 },
        width: 1.40625,
        height: 1.40625,
      },
    }}
  />
)
