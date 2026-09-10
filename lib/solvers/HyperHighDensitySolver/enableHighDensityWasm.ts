import { initializeHighDensityWasm, WasmHighDensitySolver, type HighDensityWasmInput } from "../../../rust/high-density-wasm/ts/index"
import { registerHighDensityBackend, type HighDensityBackend } from "./highDensityBackend"

const backend: HighDensityBackend = {
  createSolver: (variant, props) => new WasmHighDensitySolver(variant, props),
}

export async function enableHighDensityWasm(input: HighDensityWasmInput): Promise<void> {
  await initializeHighDensityWasm(input)
  registerHighDensityBackend(backend)
}
