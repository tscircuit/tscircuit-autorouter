/** @jsxImportSource react-for-pipeline9-fixtures */
import type { ReactElement } from "react"
import type { CircuitJson, SourceTrace } from "circuit-json"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import {
  RootCircuit,
  getSimpleRouteJsonFromCircuitJson,
} from "./pipeline9CoreRuntime.mjs"

/** A series resistor on only the positive lane; the part body is not copper. */
export async function getDifferentialPairSeriesRepro(): Promise<SimpleRouteJson> {
  const circuit = new RootCircuit()
  circuit.schematicDisabled = true
  circuit.add(
    <board width={14} height={8} routingDisabled>
      {[
        { name: "J1", x: -5 },
        { name: "MCU", x: 5 },
      ].map(
        ({ name, x }): ReactElement => (
          <chip
            key={name}
            name={name}
            pcbX={x}
            pinLabels={{ pin1: "DP", pin2: "DM" }}
            footprint={
              <footprint>
                <smtpad
                  portHints={["pin1"]}
                  pcbY={1}
                  width={0.3}
                  height={0.3}
                  shape="rect"
                />
                <smtpad
                  portHints={["pin2"]}
                  pcbY={-1}
                  width={0.3}
                  height={0.3}
                  shape="rect"
                />
              </footprint>
            }
          />
        ),
      )}
      <resistor
        name="R1"
        resistance="22"
        pcbX={0}
        pcbY={1}
        footprint={
          <footprint>
            <smtpad
              portHints={["pin1"]}
              pcbX={-0.5}
              width={0.3}
              height={0.3}
              shape="rect"
            />
            <smtpad
              portHints={["pin2"]}
              pcbX={0.5}
              width={0.3}
              height={0.3}
              shape="rect"
            />
          </footprint>
        }
      />
      <trace name="P:before" from=".J1 > .DP" to=".R1 > .pin1" />
      <trace name="P:after" from=".R1 > .pin2" to=".MCU > .DP" />
      <trace name="N" from=".J1 > .DM" to=".MCU > .DM" />
    </board>,
  )
  await circuit.renderUntilSettled()
  const circuitJson = circuit.getCircuitJson() as CircuitJson
  const { simpleRouteJson } = getSimpleRouteJsonFromCircuitJson({ circuitJson })
  const traces = circuitJson.filter(
    (element) => element.type === "source_trace",
  )
  return {
    ...simpleRouteJson,
    traces: [],
    connections: simpleRouteJson.connections.map(
      (connection): SimpleRouteConnection => ({
        ...connection,
        source_trace_id: connection.name,
        name: traces.find(
          (trace): boolean => trace.source_trace_id === connection.name,
        )!.name!,
      }),
    ),
    differentialPairs: [
      {
        connectionNames: [["P:before", "P:after"], ["N"]],
        maxLengthSkewMm: 0.05,
      },
    ],
  }
}
