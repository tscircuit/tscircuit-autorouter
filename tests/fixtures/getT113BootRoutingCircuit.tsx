/** @jsxImportSource react-for-pipeline9-fixtures */
import {
  RootCircuit,
  getSimpleRouteJsonFromCircuitJson,
} from "./pipeline9CoreRuntime.mjs"
import type { CircuitJson } from "circuit-json"
import type { SimpleRouteJson } from "lib/types"
import type { ReactElement } from "react"
import { T113S3BootRoutingChip } from "./T113S3BootRoutingChip"

const resistorFootprint = (
  <footprint>
    <smtpad
      portHints={["pin1"]}
      pcbX={-0.43}
      pcbY={0}
      width={0.56}
      height={0.54}
      shape="rect"
    />
    <smtpad
      portHints={["pin2"]}
      pcbX={0.43}
      pcbY={0}
      width={0.56}
      height={0.54}
      shape="rect"
    />
  </footprint>
)

export const T113BootRoutingCircuit = (): ReactElement => (
  <board width={44} height={44} pcbY={-8} routingDisabled layers={4}>
    <net name="GND" />
    <copperpour connectsTo="net.GND" name="GND_PLANE" layer="bottom" />
    <T113S3BootRoutingChip />
    <resistor
      name="R_BOOT_SEL1"
      resistance="3.3k"
      manufacturerPartNumber="0402WGF3301TCE"
      footprint={resistorFootprint}
      pcbX={-1.9}
      pcbY={-1.9}
      pcbRotation={270}
    />
    <trace name="BOOT_SEL1" from=".R_BOOT_SEL1 > .pin1" to=".U_SOC > .PC5" />
    <trace name="BOOT_GND" from=".R_BOOT_SEL1 > .pin2" to="net.GND" />
    {Array.from({ length: 5 }, (_, index) => (
      <resistor
        key={index}
        name={`R_SD${index}`}
        resistance="0"
        footprint={resistorFootprint}
        pcbX={-15 + index * 3}
        pcbY={-13}
        pcbRotation={270}
      />
    ))}
    {Array.from({ length: 5 }, (_, index) => (
      <trace
        key={index}
        name={`SD${index}`}
        from={`.U_SOC > .pin${7 + index}`}
        to={`.R_SD${index} > .pin1`}
      />
    ))}
    <silkscreentext pcbX={5} pcbY={-2} text="R_BOOT_SEL1 3k3" fontSize={0.7} />
    {Array.from({ length: 5 }, (_, index) => (
      <silkscreentext
        key={index}
        pcbX={-15 + index * 3}
        pcbY={-15}
        text={`R_SD${index}`}
        fontSize={0.6}
      />
    ))}
  </board>
)

export const getT113BootRoutingCircuit = async (): Promise<{
  circuitJson: CircuitJson
  srj: SimpleRouteJson
}> => {
  const circuit = new RootCircuit()
  circuit.schematicDisabled = true
  circuit.add(<T113BootRoutingCircuit />)
  await circuit.renderUntilSettled()
  const circuitJson = circuit.getCircuitJson()
  const { simpleRouteJson } = getSimpleRouteJsonFromCircuitJson({
    circuitJson,
    minTraceWidth: 0.15,
    nominalTraceWidth: 0.15,
    minViaHoleDiameter: 0.3,
    minViaPadDiameter: 0.55,
    minViaEdgeToPadEdgeClearance: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    ignoreExistingTopLevelPcbRouteState: true,
    fanoutPourNetMap: { bottom: "GND" },
  })
  if (simpleRouteJson.traces?.length) {
    throw new Error("The fixture must start without any PCB routes")
  }
  return {
    // Keep the native records untouched; older renderer types do not include
    // newer display metadata or warning records, which the renderer ignores.
    circuitJson: circuitJson as CircuitJson,
    srj: { ...simpleRouteJson, traces: [] },
  }
}
