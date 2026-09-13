import init, {
  initSync,
  type InitInput,
} from "../pkg/tiny_hypergraph_bindings.js"

// WebAssembly.Module is structurally empty in lib.dom; exclude primitive IDs.
type ModuleSource = InitInput & (string | object)
export type TinyHypergraphBindingsInput = ModuleSource | Promise<ModuleSource>

let initialization: Promise<void> | undefined
let initialized = false
let wasmMemory: WebAssembly.Memory | undefined

/** Share module initialization across solvers and concurrent callers. */
export function loadTinyHypergraphBindings(
  input?: TinyHypergraphBindingsInput,
): Promise<void> {
  if (!initialization) {
    initialization = init(
      input === undefined ? undefined : { module_or_path: input },
    )
      .then((wasm) => {
        wasmMemory = wasm.memory
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

export function initializeTinyHypergraphModule(
  module: Uint8Array<ArrayBuffer>,
): void {
  if (initialized) return
  wasmMemory = initSync({ module }).memory
  initialized = true
}

export function assertTinyHypergraphBindingsInitialized(): void {
  if (!initialized) {
    throw new Error(
      "Tiny-hypergraph WASM must be initialized before constructing a solver",
    )
  }
}

export function getTinyHypergraphMemory(): WebAssembly.Memory {
  if (!wasmMemory) {
    throw new Error(
      "Tiny-hypergraph WASM must be initialized before reading solver memory",
    )
  }
  return wasmMemory
}
