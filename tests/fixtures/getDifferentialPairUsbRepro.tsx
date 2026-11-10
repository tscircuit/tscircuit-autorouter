/** @jsxImportSource react-for-pipeline9-fixtures */
import type { CircuitJson } from "circuit-json"
import type { SimpleRouteJson } from "lib/types"
import {
  RootCircuit,
  getSimpleRouteJsonFromCircuitJson,
} from "./pipeline9CoreRuntime.mjs"

/** USB pads in board-world mm: +X right, +Y up, +Z above. */
export async function getDifferentialPairUsbRepro(): Promise<SimpleRouteJson> {
  const circuit = new RootCircuit()
  circuit.schematicDisabled = true
  circuit.add(
    <board width={18} height={10} routingDisabled>
      <chip
        name="J1"
        pcbX={-3.325}
        footprint={
          <footprint>
            {[1.3, 0.65, 0, -0.65, -1.3].map((y, index) => (
              <smtpad
                key={index}
                portHints={[`pin${index + 1}`]}
                pcbY={y}
                width={1.35}
                height={0.4}
                shape="rect"
              />
            ))}
          </footprint>
        }
        pinLabels={{ pin2: "DM", pin3: "DP" }}
      />
      <chip
        name="MCU"
        pcbX={3.85}
        footprint={
          <footprint>
            {[1.905, 0.635, -0.635, -1.905].map((y, index) => (
              <smtpad
                key={index}
                portHints={[`pin${index + 1}`]}
                pcbY={y}
                width={1}
                height={0.6}
                shape="rect"
              />
            ))}
          </footprint>
        }
        pinLabels={{ pin2: "DM", pin3: "DP" }}
      />
      <trace name="DP" from=".J1 > .DP" to=".MCU > .DP" />
      <trace name="DM" from=".J1 > .DM" to=".MCU > .DM" />
    </board>,
  )
  await circuit.renderUntilSettled()
  const { simpleRouteJson } = getSimpleRouteJsonFromCircuitJson({
    circuitJson: circuit.getCircuitJson() as CircuitJson,
  })
  const [positive, negative] = simpleRouteJson.connections
  if (simpleRouteJson.connections.length !== 2 || !positive || !negative)
    throw new Error("Expected exactly two USB lane connections")
  return {
    ...simpleRouteJson,
    traces: [],
    differentialPairs: [
      {
        connectionNames: [[positive.name], [negative.name]],
        maxLengthSkewMm: 0.1,
      },
    ],
  }
}
