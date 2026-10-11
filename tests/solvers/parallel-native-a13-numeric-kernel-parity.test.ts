import { expect, test } from "bun:test"
import { deepStrictEqual, strictEqual } from "node:assert"
import { NativeA13WasmSearchKernel } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/a13-search-wasm/NativeA13WasmSearchKernel"
import type { SearchInputs } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/a13-search-wasm/SearchInputs"
import { JavascriptSearchKernel } from "../fixtures/parallel-native-a13/JavascriptSearchKernelOracle"

test("strict native A13 C preserves fractional quanta/caps, ties, signed zero and full private heap state", (): void => {
  let seed = 13271, fixtures = 0, quanta = 0, heapRows = 0
  const random = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32 }
  for (const [cols, rows, layers] of [[3, 3, 1], [9, 7, 2], [31, 29, 4], [67, 53, 4]]) {
    const plane = cols! * rows!, states = plane * layers!
    for (let trial = 0; trial < 6; trial++) {
      const input: SearchInputs = { traceCost: new Uint16Array(states), viaCost: new Uint16Array(plane), fixed: new Uint8Array(states),
        fixedVia: new Uint8Array(plane), history: new Float64Array(states), viaHistory: new Float64Array(plane),
        heuristicCost: new Float64Array(states), viaAllowed: new Uint8Array(plane) }
      input.viaAllowed.fill(1)
      for (let index = 0; index < states; index++) {
        input.traceCost[index] = Math.floor(random() * 4)
        input.history[index] = random() < .3 ? -0 : Math.floor(random() * 5) * .125
        input.fixed[index] = random() < .05 ? 1 : 0
      }
      for (let index = 0; index < plane; index++) {
        input.viaCost[index] = Math.floor(random() * 3)
        input.viaHistory[index] = random() < .3 ? -0 : Math.floor(random() * 3) * .1
        input.fixedVia[index] = random() < .05 ? 1 : 0
      }
      const native = new JavascriptSearchKernel(cols!, rows!, layers!, .1, .10000000000000002)
      const wasm = new NativeA13WasmSearchKernel(cols!, rows!, layers!, .1, .10000000000000002)
      const start = Math.floor(random() * states), goal = Math.floor(random() * states), budget = [1, 13.5, states * 5 + .5][trial % 3]!
      native.begin(input, start, goal, trial % 2 ? -0 : .5); wasm.begin(input, start, goal, trial % 2 ? -0 : .5)
      let expansions = 0
      for (let call = 0; call <= states * 10; call++) {
        const steps = [1, 7.5, 1000][call % 3]!, a = native.run(steps, budget - expansions), b = wasm.run(steps, budget - expansions)
        deepStrictEqual(b, a)
        const expected = (native as any).proofState(), kernel = wasm as any, memory = kernel.exports.memory.buffer, offsets = kernel.offsets
        for (const [name, Type, offset] of [["distance", Float64Array, 8], ["parent", Int32Array, 9], ["stateXY", Int32Array, 10], ["versions", Uint32Array, 12]] as const)
          deepStrictEqual(new Type(memory, offsets[offset], states), expected[name])
        const flags = new Int32Array(memory, offsets[11], states), heap = new DataView(memory, offsets[13], kernel.heapCapacity * 16)
        for (let index = 0; index < states; index++) strictEqual(flags[index], expected.stateFlags[index])
        strictEqual(kernel.heapCapacity, expected.heapCapacity)
        for (let index = 0; index < kernel.heapCapacity; index++) {
          strictEqual(Object.is(heap.getFloat64(index * 16, true), expected.heapF[index]), true)
          strictEqual(heap.getInt32(index * 16 + 8, true), expected.heapIndex[index])
          strictEqual(heap.getUint32(index * 16 + 12, true), expected.heapVersion[index])
        }
        quanta++; heapRows += kernel.heapCapacity; expansions += a.expansions
        if (a.status !== 0) break
        if (call === states * 10) throw new Error("Native numeric search did not reach a terminal state")
      }
      fixtures++
    }
  }
  expect(fixtures).toBe(24)
  expect(quanta).toBe(126)
  expect(heapRows).toBe(129024)
})
