import { HighDensityDebugger } from "lib/testing/HighDensityDebugger"
import { HyperHighDensityDebugger } from "lib/testing/HyperHighDensityDebugger"

const inputs = {
  nodeWithPortPoints: {
    capacityMeshNodeId: "cn3165",
    portPoints: [
      { x: 32.5, y: 5.625, z: 0, connectionName: "connectivity_net926" },
      { x: 30.625, y: 5, z: 0, connectionName: "connectivity_net915" },
      {
        x: 30,
        y: 5.833333333333333,
        z: 0,
        connectionName: "connectivity_net915",
      },
      {
        x: 30,
        y: 5.416666666666667,
        z: 0,
        connectionName: "connectivity_net926",
      },
    ],
    center: { x: 31.25, y: 6.25 },
    width: 2.5,
    height: 2.5,
  },
}

export default () => (
  <div>
    <HighDensityDebugger
      hyperParameters={{
        // CELL_SIZE_FACTOR: 1,
        // FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR: 2,
        // FUTURE_CONNECTION_PROXIMITY_VD: 1,
        FLIP_TRACE_ALIGNMENT_DIRECTION: true,
        // FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR: 2,
      }}
      {...inputs}
    />
    {/* <HyperHighDensityDebugger {...inputs} /> */}
  </div>
)
