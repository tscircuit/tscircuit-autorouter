import * as bindings from "../../rust/capacity-autorouter-bindings/pkg/capacity_autorouter_bindings.js"
import { decodeEmbeddedModule } from "lib/bindings/decodeEmbeddedModule"
import { wasmBase64 } from "lib/bindings/generated/autorouterModule"

let initialized = false

export function initializeAutorouterBindings(): void {
  if (initialized) return
  const module = decodeEmbeddedModule(wasmBase64)
  bindings.initSync({ module })
  initialized = true
}
