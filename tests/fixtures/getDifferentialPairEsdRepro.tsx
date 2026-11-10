/** @jsxImportSource react-for-pipeline9-fixtures */
import type { CircuitJson } from "circuit-json"
import type { SimpleRouteJson } from "lib/types"
import {
  RootCircuit,
  getSimpleRouteJsonFromCircuitJson,
} from "./pipeline9CoreRuntime.mjs"

/** TSX pads in board-world mm, +X right, +Y up, +Z above. No pre-routed copper. */
export async function getDifferentialPairEsdRepro(
  mcuX = -3,
): Promise<SimpleRouteJson> {
  const circuit = new RootCircuit()
  circuit.schematicDisabled = true
  circuit.add(
    <board width={18} height={14} routingDisabled>
      {[
        { name: "J1", x: -5, y: -3 },
        { name: "ESD", x: 5, y: -3 },
        { name: "MCU", x: mcuX, y: -3 },
        { name: "TP", x: 5, y: 1 },
      ].map(({ name, x, y }) => (
        <chip
          key={name}
          name={name}
          pcbX={x}
          pcbY={y}
          pinLabels={{ pin1: "DP", pin2: "DM" }}
          footprint={
            <footprint>
              <smtpad
                portHints={["pin1"]}
                pcbY={0.7}
                width={0.6}
                height={0.6}
                shape="rect"
              />
              <smtpad
                portHints={["pin2"]}
                pcbY={-0.7}
                width={0.6}
                height={0.6}
                shape="rect"
              />
            </footprint>
          }
        />
      ))}
      <trace name="P:0" from=".J1 > .DP" to=".ESD > .DP" />
      <trace name="P:1" from=".ESD > .DP" to=".MCU > .DP" />
      <trace name="N:0" from=".J1 > .DM" to=".ESD > .DM" />
      <trace name="N:1" from=".ESD > .DM" to=".MCU > .DM" />
      <trace name="tap" from=".ESD > .DP" to=".TP > .DP" />
    </board>,
  )
  await circuit.renderUntilSettled()
  const circuitJson = circuit.getCircuitJson() as CircuitJson
  const { simpleRouteJson } = getSimpleRouteJsonFromCircuitJson({ circuitJson })
  const sourceTraces = circuitJson.filter(
    (element) => element.type === "source_trace",
  )
  return {
    ...simpleRouteJson,
    traces: [],
    // Human-readable hop names; all geometry and pad identities come from TSX.
    connections: simpleRouteJson.connections.map((connection) => ({
      ...connection,
      name: sourceTraces.find(
        (trace) => trace.source_trace_id === connection.name,
      )!.name!,
    })),
    differentialPairs: [
      {
        connectionNames: [
          ["P:0", "P:1"],
          ["N:0", "N:1"],
        ],
        maxLengthSkewMm: 0.1,
      },
    ],
  }
}
