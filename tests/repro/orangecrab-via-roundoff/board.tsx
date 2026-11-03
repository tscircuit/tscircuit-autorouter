/** @jsxImportSource react */
import source from "./source-data.json"
import { NativePart } from "./native-part"

const bytes = ["byte0", "byte1"]
const phases = [...bytes, "remaining"]

/** Native board-world millimeters: +X right, +Y up, +Z above, right-handed. */
export const board = (
  <board
    title={source.title}
    width={source.width}
    height={source.height}
    layers={source.layers}
    schematicDisabled
    routeRemaining={false}
    isViaInPadAllowed={false}
    minTraceWidth={Math.min(...source.rules.widths)}
    minTraceToPadEdgeClearance={source.rules.appliedGlobalClearance}
    minViaEdgeToPadEdgeClearance={source.rules.appliedGlobalClearance}
    minViaPadDiameter={source.rules.viaPad}
    minViaHoleDiameter={source.rules.viaDrill}
  >
    {source.parts.map((part) => (
      <NativePart key={part.name} part={part} />
    ))}
    {phases.map((group, phaseIndex) => (
      <autoroutingphase
        key={group}
        name={group}
        phaseIndex={phaseIndex}
        autorouter={bytes.includes(group) ? "bus_lanes" : "auto_local"}
        connections={source.traces
          .filter((trace) => trace.group === group)
          .map((trace) => trace.name)}
      />
    ))}
    {source.traces.map((trace) => (
      <trace
        key={trace.name}
        name={trace.name}
        path={trace.path}
        thickness={trace.width}
        routingPhaseIndex={phases.indexOf(trace.group)}
      />
    ))}
    {bytes.map((group) => (
      <bus
        key={group}
        name={`DDR_BUS_${group}`}
        routingPhaseIndex={phases.indexOf(group)}
        connections={source.traces
          .filter((trace) => trace.group === group)
          .map((trace) => trace.name)}
        pcbAllowedLayers={source.signalLayers}
      />
    ))}
    <pcbnotetext
      pcbY={source.height / 2 - 0.8}
      fontSize={0.5}
      text={`${source.title}: 50 DDR nets requested`}
    />
    <pcbnotetext
      pcbY={-source.height / 2 + 0.8}
      fontSize={0.45}
      text="Native geometry; no via-in-pad. Bus bytes, then remaining signals. Timing unqualified."
    />
  </board>
)
