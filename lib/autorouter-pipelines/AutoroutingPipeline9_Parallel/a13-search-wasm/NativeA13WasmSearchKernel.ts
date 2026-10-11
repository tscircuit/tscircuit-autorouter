import { kernelBase64 } from "./kernelBytes"

import type { SearchInputs } from "./SearchInputs"

type KernelExports = {
  memory: WebAssembly.Memory
  __heap_base: WebAssembly.Global
  configure: (
    cols: number,
    rows: number,
    layers: number,
    pitchX: number,
    pitchY: number,
    addresses: number,
    capacity: number,
  ) => void
  begin_search: (start: number, goal: number, presentCost: number) => void
  run: (steps: number, budget: number) => number
  get_expansions: () => number
  get_pops: () => number
  set_heap_capacity: (capacity: number) => void
}
let compiledModule: WebAssembly.Module | undefined

/** One private memory per solver; the compiled, immutable module is shared.
 * The TS router retains all policy, validation, and debugger state. */
export class NativeA13WasmSearchKernel {
  protected exports: KernelExports
  protected offsets: number[] = []
  private states: number
  private heapCapacity = 1024
  constructor(
    cols: number,
    rows: number,
    layers: number,
    pitchX: number,
    pitchY: number,
  ) {
    compiledModule ??= new WebAssembly.Module(
      Uint8Array.from(atob(kernelBase64), (c) => c.charCodeAt(0)),
    )
    this.exports = new WebAssembly.Instance(compiledModule)
      .exports as KernelExports
    const plane = cols * rows
    this.states = plane * layers
    let cursor = Number(this.exports.__heap_base.value)
    const addresses = cursor
    cursor += 14 * 4
    for (const bytes of [
      this.states * 2,
      plane * 2,
      this.states,
      plane,
      this.states * 8,
      plane * 8,
      this.states * 8,
      plane,
      this.states * 8,
      this.states * 4,
      this.states * 4,
      this.states * 4,
      this.states * 4,
      this.heapCapacity * 16,
    ]) {
      cursor = Math.ceil(cursor / 8) * 8
      this.offsets.push(cursor)
      cursor += bytes
    }
    this.ensureMemory(cursor)
    new Int32Array(this.exports.memory.buffer, addresses, 14).set(this.offsets)
    this.exports.configure(
      cols,
      rows,
      layers,
      pitchX,
      pitchY,
      addresses,
      this.heapCapacity,
    )
  }
  private ensureMemory(bytes: number) {
    const memory = this.exports.memory
    if (bytes > memory.buffer.byteLength)
      memory.grow(Math.ceil((bytes - memory.buffer.byteLength) / 65536))
  }
  begin(
    inputs: SearchInputs,
    start: number,
    goal: number,
    presentCost: number,
  ) {
    // Views are intentionally recreated: memory.grow detaches old JS views.
    const target = new Uint8Array(this.exports.memory.buffer)
    const sources = [
      inputs.traceCost,
      inputs.viaCost,
      inputs.fixed,
      inputs.fixedVia,
      inputs.history,
      inputs.viaHistory,
      inputs.heuristicCost,
      inputs.viaAllowed,
    ]
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i]!
      target.set(
        new Uint8Array(source.buffer, source.byteOffset, source.byteLength),
        this.offsets[i]!,
      )
    }
    this.exports.begin_search(start, goal, presentCost)
  }
  run(steps: number, budget: number) {
    let expansions = 0,
      status = 0
    let remaining = Math.ceil(steps)
    while (remaining > 0) {
      status = this.exports.run(
        Math.min(remaining, 1_000_000),
        Math.min(Math.ceil(budget - expansions), 0x7fffffff),
      )
      remaining -= this.exports.get_pops()
      expansions += this.exports.get_expansions()
      if (status === 4) {
        this.heapCapacity *= 2
        this.ensureMemory(this.offsets[13]! + this.heapCapacity * 16)
        this.exports.set_heap_capacity(this.heapCapacity)
      } else if (status !== 0) break
    }
    return { status, expansions }
  }
  copyParents(target: Int32Array) {
    target.set(
      new Int32Array(this.exports.memory.buffer, this.offsets[9]!, this.states),
    )
  }
}
