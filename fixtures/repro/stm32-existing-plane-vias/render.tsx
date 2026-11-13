import { Circuit } from "@tscircuit/core"
import type { AutorouterProp } from "@tscircuit/props"
import { EventEmitter } from "node:events"
import { writeFileSync } from "node:fs"
import { gzipSync } from "node:zlib"
import Stm32ExistingPlaneVias from "./board"

type CaptureAutorouter = {
  on: EventEmitter["on"]
  stop: EventEmitter["removeAllListeners"]
  start: () => void
}

// Capture the real core -> router handoff after native dogbone has run.
// No saved routes, injected obstacles, or edited connectivity metadata.
const circuit = new Circuit()
let capturedInput: unknown
const autorouter: AutorouterProp = {
  local: true,
  async algorithmFn(input): Promise<CaptureAutorouter> {
    if (capturedInput) throw new Error("Expected one remaining-routing input")
    capturedInput = structuredClone(input)
    const events = new EventEmitter()
    return {
      on: events.on.bind(events),
      stop: events.removeAllListeners.bind(events),
      start(): void {
        // Remaining routing is intentionally not run; no routes are injected.
        events.emit("complete", { type: "complete", traces: [] })
      },
    }
  },
}
circuit.add(<Stm32ExistingPlaneVias autorouter={autorouter} />)
await circuit.renderUntilSettled()
if (!capturedInput) throw new Error("Native dogbone did not reach board routing")
const json = circuit.getCircuitJson()
const cpu = json.find(
  (element) => element.type === "source_component" && element.name === "U70",
)
if (cpu?.type !== "source_component") {
  throw new Error("STM32 source component missing")
}
const pcbCpu = json.find(
  (element) => element.type === "pcb_component" &&
    element.source_component_id === cpu.source_component_id,
)
if (pcbCpu?.type !== "pcb_component") {
  throw new Error("STM32 PCB component missing")
}
const cpuPads = json
  .filter((element) => element.type === "pcb_smtpad" &&
    element.pcb_component_id === pcbCpu.pcb_component_id)
  .map((pad) => {
    if (pad.type !== "pcb_smtpad" || pad.shape !== "circle") {
      throw new Error("Expected circular STM32 pads")
    }
    return { x: pad.x, y: pad.y, radius: pad.radius }
  })
const exits = json.filter((element) => element.type === "pcb_breakout_point")
const vias = json.filter((element) => element.type === "pcb_via")
const cpuGroundPointIds = exits.map((exit) => exit.pcb_breakout_point_id)
const cpuTraces = json
  .filter((element) => element.type === "pcb_trace")
  .map((trace) => trace.route.filter((point) => point.route_type === "wire"))
if (cpuPads.length !== 354 || exits.length !== 104 || vias.length !== 104) {
  throw new Error("Expected full STM32 footprint and 104 native ground escapes")
}
const output = new URL(
  "../../../tests/repro/assets/stm32-existing-plane-vias.srj.json.gz",
  import.meta.url,
)
writeFileSync(output, gzipSync(JSON.stringify({
  provenance: {
    source: "fixtures/repro/stm32-existing-plane-vias/board.tsx",
    runtime: "tscircuit@0.0.3163",
    note: "Full STM32 footprint and motherboard GND connections; other subsystems omitted. Native dogbone then unmodified remaining-routing input; no saved routing.",
  },
  inputSrj: capturedInput,
  cpuGroundPointIds,
  cpuPads,
  cpuTraces,
})))
console.log(`Generated ${output.pathname}: ${cpuPads.length} pads, ${exits.length} native ground escapes`)
