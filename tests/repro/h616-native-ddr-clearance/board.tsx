import type { ReactElement } from "react"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { NativePart } from "./native-part"

type NativeH616Source = {
  title: string
  width: number
  height: number
  parts: Parameters<typeof NativePart>[0]["part"][]
  traces: {
    name: string
    group: string
    path: string[]
    width: number
  }[]
}

const source: NativeH616Source = JSON.parse(
  gunzipSync(
    new Uint8Array(readFileSync(new URL("./source.json.gz", import.meta.url))),
  ).toString("utf8"),
)
const phaseNames = ["byte0", "byte1", "remaining"]
const connectionsByPhase = phaseNames.map((group) =>
  source.traces
    .filter((trace) => trace.group === group)
    .map((trace) => trace.name),
)

export function H616DdrBoard(): ReactElement {
  return (
    <board
      title={source.title}
      width={source.width}
      height={source.height}
      layers={4}
      schematicDisabled
      routeRemaining={false}
      isViaInPadAllowed={false}
      minTraceWidth={0.093}
      minTraceToPadEdgeClearance={0.1}
      minViaEdgeToPadEdgeClearance={0.1}
      minViaPadDiameter={0.35}
      minViaHoleDiameter={0.15}
    >
      {source.parts.map((part) => (
        <NativePart key={part.name} part={part} />
      ))}
      <autoroutingphase
        name="byte0"
        phaseIndex={0}
        autorouter="bus_lanes"
        connections={connectionsByPhase[0]}
      />
      <autoroutingphase
        name="byte1"
        phaseIndex={1}
        autorouter="bus_lanes"
        connections={connectionsByPhase[1]}
      />
      <autoroutingphase
        name="remaining"
        phaseIndex={2}
        autorouter="auto_local"
        connections={connectionsByPhase[2]}
      />
      {source.traces.map((trace) => (
        <trace
          key={trace.name}
          name={trace.name}
          path={trace.path}
          thickness={trace.width}
          routingPhaseIndex={phaseNames.indexOf(trace.group)}
        />
      ))}
      <bus
        name="DDR_BUS_byte0"
        routingPhaseIndex={0}
        connections={connectionsByPhase[0]}
        pcbAllowedLayers={["top", "inner1", "inner2", "bottom"]}
      />
      <bus
        name="DDR_BUS_byte1"
        routingPhaseIndex={1}
        connections={connectionsByPhase[1]}
        pcbAllowedLayers={["top", "inner1", "inner2", "bottom"]}
      />
      <pcbnotetext
        pcbY={source.height / 2 - 0.8}
        fontSize={0.5}
        text="H616 DDR3: 384 native pads, 53 requested signals"
      />
    </board>
  )
}
