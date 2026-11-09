import type { ReactElement } from "react"
import source from "../h3-ddr-strobe-via-access/source.json"
import { NativeH3Part } from "./native-part"

const byte0 = source.traces
  .filter((trace) => trace.group === "byte0")
  .map((trace) => trace.name)
const byte1 = source.traces
  .filter((trace) => trace.group === "byte1")
  .map((trace) => trace.name)

export const requestedNames = [...byte0, ...byte1, "N017_SBA1"]

export function H3DdrBankAddressBoard(): ReactElement {
  return (
    <board
      title={source.title}
      width={source.width}
      height={source.height}
      layers={source.layers}
      schematicDisabled
      routeRemaining={false}
      isViaInPadAllowed={false}
      minTraceWidth={0.1143}
      minTraceToPadEdgeClearance={0.0889}
      minViaEdgeToPadEdgeClearance={0.0889}
      minViaPadDiameter={0.45}
      minViaHoleDiameter={0.2}
    >
      {source.parts.map((part) => (
        <NativeH3Part key={part.name} part={part} />
      ))}
      <autoroutingphase
        name="byte0"
        phaseIndex={0}
        autorouter="bus_lanes"
        connections={byte0}
      />
      <autoroutingphase
        name="byte1"
        phaseIndex={1}
        autorouter="bus_lanes"
        connections={byte1}
      />
      <autoroutingphase
        name="remaining"
        phaseIndex={2}
        autorouter="auto_local"
        connections={["N017_SBA1"]}
      />
      {source.traces.map((trace) => {
        let routingPhaseIndex: number | undefined
        if (trace.group === "byte0") routingPhaseIndex = 0
        if (trace.group === "byte1") routingPhaseIndex = 1
        if (trace.name === "N017_SBA1") routingPhaseIndex = 2
        return (
          <trace
            key={trace.name}
            name={trace.name}
            path={trace.path}
            thickness={trace.width}
            routingPhaseIndex={routingPhaseIndex}
          />
        )
      })}
      <bus
        name="DDR_BUS_byte0"
        routingPhaseIndex={0}
        connections={byte0}
        pcbAllowedLayers={["top", "bottom"]}
      />
      <bus
        name="DDR_BUS_byte1"
        routingPhaseIndex={1}
        connections={byte1}
        pcbAllowedLayers={["top", "bottom"]}
      />
      <pcbnotetext
        pcbY={source.height / 2 - 0.8}
        fontSize={0.5}
        text="H3 DDR3: route 16 DQ lines, then BA1"
      />
      <pcbnotetext
        pcbY={-source.height / 2 + 0.8}
        fontSize={0.45}
        text="445 native pads; two layers; no via-in-pad. Timing unqualified."
      />
    </board>
  )
}
