import init, { type InitInput } from "../pkg/tiny_hypergraph_wasm.js"

// WebAssembly.Module is structurally empty in lib.dom; exclude primitive IDs.
type WasmSource = InitInput & (string | object)
export type TinyHyperGraphWasmInput = WasmSource | Promise<WasmSource>

let initialization: Promise<void> | undefined
let initialized = false

/** Share module initialization across solvers and concurrent callers. */
export function initTinyHypergraphWasm(input?: TinyHyperGraphWasmInput): Promise<void> {
  if (!initialization) {
    initialization = init(input === undefined ? undefined : { module_or_path: input })
      .then(() => {
        initialized = true
      })
      .catch((error: unknown) => {
        // A later explicit call can retry a failed fetch/instantiation.
        initialization = undefined
        throw error
      })
  }
  return initialization
}

export function assertTinyHypergraphWasmInitialized(): void {
  if (!initialized) {
    throw new Error(
      "Call and await initTinyHypergraphWasm() before constructing a solver",
    )
  }
}
