import { heapKernelBytes } from "./heapKernelBytes"

export type NativeA01HeapColumns = { f: number[]; seq: number[]; id: number[]; n: number }
type KernelExports = {
  memory: WebAssembly.Memory
  __heap_base: WebAssembly.Global
  push: (f: number, seq: number, id: number, flags: number, rows: number,
    meta: number, n: number, valueF: number, valueSeq: number, valueId: number) => void
  pop: (f: number, seq: number, id: number, flags: number, rows: number,
    meta: number, n: number) => number
}
const MAX_ROWS = 262_144, PAGE_BYTES = 65_536
let compiledModule: WebAssembly.Module | undefined

/** Isolated prototype: no owner installation or public pipeline integration. */
export class NativeA01HeapArena {
  readonly diagnostics = { batches: 0, hydratedRows: 0, flushedRows: 0, memoryBytes: 0 }
  private readonly exports: KernelExports
  private readonly pointers: readonly number[]
  private readonly f: Float64Array
  private readonly seq: Float64Array
  private readonly id: Float64Array
  private readonly flags: Uint32Array
  private readonly rows: Uint32Array
  private readonly meta: Uint32Array
  private heap: NativeA01HeapColumns | null = null

  constructor(readonly capacityRows: number) {
    if (!Number.isSafeInteger(capacityRows) || capacityRows < 1 || capacityRows > MAX_ROWS) {
      throw new RangeError("A01 heap arena capacity must be within 1..262144 rows")
    }
    compiledModule ??= new WebAssembly.Module(heapKernelBytes)
    if (WebAssembly.Module.imports(compiledModule).length !== 0) throw new Error("A01 heap kernel has runtime imports")
    const instance = new WebAssembly.Instance(compiledModule)
    this.exports = instance.exports as unknown as KernelExports
    const base = Math.ceil(Number(this.exports.__heap_base.value) / 8) * 8
    const pointers: number[] = []
    for (let index = 0; index < 3; index++) pointers[index] = base + index * capacityRows * 8
    pointers[3] = base + capacityRows * 24
    pointers[4] = base + capacityRows * 28
    pointers[5] = base + capacityRows * 32
    const bytes = pointers[5]! + 8, memory = this.exports.memory
    const neededPages = Math.ceil(bytes / PAGE_BYTES), currentPages = memory.buffer.byteLength / PAGE_BYTES
    if (neededPages > currentPages) memory.grow(neededPages - currentPages)
    this.pointers = pointers
    this.f = new Float64Array(memory.buffer, pointers[0]!, capacityRows)
    this.seq = new Float64Array(memory.buffer, pointers[1]!, capacityRows)
    this.id = new Float64Array(memory.buffer, pointers[2]!, capacityRows)
    this.flags = new Uint32Array(memory.buffer, pointers[3]!, capacityRows)
    this.rows = new Uint32Array(memory.buffer, pointers[4]!, capacityRows)
    this.meta = new Uint32Array(memory.buffer, pointers[5]!, 2)
    this.diagnostics.memoryBytes = capacityRows * 32 + 8
  }

  /** Rehydrate ALL active and inactive rows after every observer boundary. */
  begin(heap: NativeA01HeapColumns): void {
    if (this.heap) throw new Error("A01 heap arena already has an active quantum")
    const length = heap.f.length
    if (!Number.isSafeInteger(heap.n) || heap.n < 0 || heap.n > length ||
      length !== heap.seq.length || length !== heap.id.length || length > this.capacityRows) {
      throw new Error("A01 heap arena received invalid native columns")
    }
    for (let index = 0; index < length; index++) {
      const f = heap.f[index], seq = heap.seq[index], id = heap.id[index]
      if (typeof f !== "number" || typeof seq !== "number" || typeof id !== "number") {
        throw new Error("A01 heap arena requires complete numeric native rows")
      }
      this.f[index] = f
      this.seq[index] = seq
      this.id[index] = id
    }
    this.meta[0] = 0
    let generation = (this.meta[1]! + 1) >>> 0
    if (generation === 0) { this.flags.fill(0); generation = 1 }
    this.meta[1] = generation
    this.heap = heap
    this.diagnostics.batches++
    this.diagnostics.hydratedRows += length
  }

  push(valueF: number, valueSeq: number, valueId: number): void {
    const heap = this.heap
    if (!heap) throw new Error("A01 heap push has no active quantum")
    if (typeof valueF !== "number" || typeof valueSeq !== "number" || typeof valueId !== "number") {
      throw new Error("A01 heap arena requires numeric native push values")
    }
    if (heap.n >= this.capacityRows) throw new Error("A01 heap exceeds its proven arena capacity")
    const n = heap.n++
    this.exports.push(this.pointers[0]!, this.pointers[1]!, this.pointers[2]!,
      this.pointers[3]!, this.pointers[4]!, this.pointers[5]!, n, valueF, valueSeq, valueId)
  }

  pop(): number {
    const heap = this.heap
    if (!heap || heap.n < 1) throw new Error("A01 heap pop requires an active nonempty quantum")
    const n = heap.n--
    return this.exports.pop(this.pointers[0]!, this.pointers[1]!, this.pointers[2]!,
      this.pointers[3]!, this.pointers[4]!, this.pointers[5]!, n)
  }

  /** Run in the caller's finally, before any native observer or history step. */
  finish(): void {
    const heap = this.heap
    if (!heap) throw new Error("A01 heap arena has no active quantum to finish")
    try {
      const count = this.meta[0]!
      for (let index = 0; index < count; index++) {
        const row = this.rows[index]!
        heap.f[row] = this.f[row]!
        heap.seq[row] = this.seq[row]!
        heap.id[row] = this.id[row]!
      }
      this.diagnostics.flushedRows += count
    } finally { this.heap = null }
  }
}
