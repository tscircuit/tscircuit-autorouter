import { HighDensityDebugger } from "lib/testing/HighDensityDebugger"

export default () => (
  <HighDensityDebugger
    hyperParameters={{
      CELL_SIZE_FACTOR: 0.25,
    }}
    {...{
      nodeWithPortPoints: {
        capacityMeshNodeId: "cn2739",
        portPoints: [
          {
            x: -42.40051819999998,
            y: -14.1015625,
            connectionName: "source_trace_13",
            z: 0,
          },
          {
            x: -42.40051819999998,
            y: -12.8125,
            connectionName: "source_trace_13",
            z: 0,
          },
          {
            x: -43.04504944999998,
            y: -13.671875,
            connectionName: "source_trace_37",
            z: 0,
          },
          {
            x: -43.04504944999998,
            y: -13.2421875,
            connectionName: "source_trace_40",
            z: 0,
          },
          {
            x: -41.11145569999998,
            y: -13.671875,
            connectionName: "source_trace_37",
            z: 0,
          },
          {
            x: -41.11145569999998,
            y: -13.2421875,
            connectionName: "source_trace_40",
            z: 0,
          },
        ],
        center: { x: -42.40051819999998, y: -13.45703125 },
        width: 1.2890625,
        height: 1.2890625,
      },
    }}
  />
)
