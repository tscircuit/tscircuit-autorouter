import * as bindings from "../../rust/autorouter-bindings/pkg/autorouter_bindings.js"
import { decodeEmbeddedModule } from "./decodeEmbeddedModule"
import { wasmBase64 } from "./generated/autorouterModule"

let initialized = false

export function initializeAutorouterBindings(): void {
  if (initialized) return
  const module = decodeEmbeddedModule(wasmBase64)
  bindings.initSync({ module })
  initialized = true
}
