import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import {
  RootCircuit,
  type AutoroutingStartEvent,
  type SolverStartedEvent,
} from "tscircuit"
import LoRaLinkV1 from "./index.circuit"

const circuit = new RootCircuit({ platform: { partsEngineDisabled: true } })
const inputs: SolverStartedEvent["solverParams"][] = []
const phases: AutoroutingStartEvent[] = []
circuit.on("solver:started", (event): void => {
  if (event.solverName === "AutoroutingPipelineSolver9_PreloadedTraceGraph") {
    // Capture at the native constructor boundary, before any routing steps.
    inputs.push(structuredClone(event.solverParams))
  }
})
circuit.on("autorouting:start", (event): void => {
  phases.push(event)
})
circuit.add(LoRaLinkV1())
await circuit.renderUntilSettled()

assert.equal(inputs.length, 1)
assert.equal(phases.length, 1)
assert.equal(phases[0]!.phaseName, "02-signals-power-and-ground")
assert.equal(inputs[0]!.input.layerCount, 4)
assert.equal(inputs[0]!.options.effort, 5)
assert.equal(inputs[0]!.options.cacheProvider, null)
const circuitJson = circuit.getCircuitJson()
assert.equal(circuitJson.filter((element) => element.type === "pcb_component").length, 52)
assert.equal(circuitJson.filter((element) => element.type === "source_net").length, 29)
writeFileSync(
  new URL("./loralink-v1.solver-input.json", import.meta.url),
  `${JSON.stringify(inputs[0], null, 2)}\n`,
)
console.log("Captured native LoRaLink Pipeline 9 input and options")
