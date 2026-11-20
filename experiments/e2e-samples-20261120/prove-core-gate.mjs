import { RootCircuit } from "../../core/lib/index.ts"
import { writeFileSync } from "node:fs"

const roots = new Set()
const routingStarts = new WeakMap()
RootCircuit.prototype.renderUntilSettled = new Proxy(RootCircuit.prototype.renderUntilSettled, {
  apply(render, circuit, args) {
    roots.add(circuit)
    return Reflect.apply(render, circuit, args)
  },
})
RootCircuit.prototype.emit = new Proxy(RootCircuit.prototype.emit, {
  apply(emit, circuit, args) {
    if (args[0] === "autorouting:start") {
      const phases = routingStarts.get(circuit) ?? []
      phases.push({ name: args[1].phaseName, solver: args[1].solverName })
      routingStarts.set(circuit, phases)
    }
    return Reflect.apply(emit, circuit, args)
  },
})
process.on("exit", () => {
  const proof = [...roots].map((circuit) => ({
    phases: routingStarts.get(circuit) ?? [],
    errors: circuit.db.pcb_autorouting_error.list().map((error) => error.message),
    breakoutPoints: circuit.db.pcb_breakout_point.list().length,
    traces: circuit.db.pcb_trace.list().length,
    vias: circuit.db.pcb_via.list().length,
  }))
  writeFileSync(process.env.E2E_GATE_PROOF_PATH, JSON.stringify(proof, null, 2) + "\n")
  console.log("CORE_GATE_PROOF", JSON.stringify(proof))
})
