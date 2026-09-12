import { initializeTinyHypergraphModule } from "../../rust/tiny-hypergraph-bindings/ts/loadTinyHypergraphBindings"
import { decodeEmbeddedModule } from "./decodeEmbeddedModule"
import { wasmBase64 } from "./generated/tinyHypergraphModule"

let initialized = false

export function initializeTinyHypergraphBindings(): void {
  if (initialized) return
  const module = decodeEmbeddedModule(wasmBase64)
  initializeTinyHypergraphModule(module)
  initialized = true
}
