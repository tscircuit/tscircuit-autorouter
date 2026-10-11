import { expect, test } from "bun:test"
import { NativeA13WasmSearchKernel } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/a13-search-wasm/NativeA13WasmSearchKernel"
import type { SearchInputs } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/a13-search-wasm/SearchInputs"

test("unbranded internal A13 kernels freshly upload all mutable inputs at every original begin", (): void => {
  const states = 32, plane = 16
  const inputs: SearchInputs = {
    traceCost: new Uint16Array(states), viaCost: new Uint16Array(plane),
    fixed: new Uint8Array(states), fixedVia: new Uint8Array(plane),
    history: new Float64Array(states), viaHistory: new Float64Array(plane),
    heuristicCost: new Float64Array(states), viaAllowed: new Uint8Array(plane).fill(1),
  }
  const kernel = new NativeA13WasmSearchKernel(4, 4, 2, 0.1, 0.1)
  kernel.begin(inputs, 0, 31, 0.5)
  kernel.run(1, 100)
  inputs.traceCost.fill(31); inputs.viaCost.fill(17)
  inputs.fixed.fill(1); inputs.fixedVia.fill(1); inputs.viaAllowed.fill(0)
  inputs.history.fill(-0); inputs.viaHistory.fill(Infinity); inputs.heuristicCost.fill(NaN)
  kernel.begin(inputs, 0, 31, 0.7)
  const privateKernel = kernel as unknown as { exports: { memory: WebAssembly.Memory }; offsets: number[] }
  for (const [index, source] of Object.values(inputs).entries()) {
    const actual = new Uint8Array(privateKernel.exports.memory.buffer, privateKernel.offsets[index]!, source.byteLength)
    expect(Array.from(actual)).toEqual(Array.from(new Uint8Array(source.buffer, source.byteOffset, source.byteLength)))
  }
})
