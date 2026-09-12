import { readFile } from "node:fs/promises"
import init, { TinyHyperGraphSolver as RawSolver } from "../pkg/tiny_hypergraph_bindings.js"
import { encodeJsonInput, decodeUndefinedJsonOutput } from "../dist/jsonWire.js"

const bytes = await readFile(new URL("../pkg/tiny_hypergraph_bindings_bg.wasm", import.meta.url))
await init({ module_or_path: bytes })

// Keep raw WASM lifecycle coverage while unpacking its typed JSON transport.
export class TinyHyperGraphSolver extends RawSolver {
  constructor(topology, problem, options, configuration) {
    super(encodeJsonInput(topology), encodeJsonInput(problem), encodeJsonInput(options ?? null), encodeJsonInput(configuration ?? null))
  }
  getRoutingSnapshot() {
    return decodeUndefinedJsonOutput(super.getRoutingSnapshot())
  }
  getOutput() {
    return decodeUndefinedJsonOutput(super.getOutput())
  }
  getStats() {
    return decodeUndefinedJsonOutput(super.getStats())
  }
  visualize() {
    return decodeUndefinedJsonOutput(super.visualize())
  }
}

export { createInput } from "./fixture.mjs"
