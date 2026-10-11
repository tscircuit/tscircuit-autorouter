import { expect, test } from "bun:test"
import { neighborKernelBytes } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/pathingWasm/neighborKernelBytes"
test("strict WASM CSR scan retains ordered native numeric fields, mask boundaries and goal precedence", (): void => {
const module = new WebAssembly.Module(neighborKernelBytes)
expect(WebAssembly.Module.imports(module)).toEqual([])
const instance = new WebAssembly.Instance(module)
const e = instance.exports as any
const lengths = [128, 128, 128, 96, 96, 96, 96, 96, 8, 96, 192, 192, 4, 128, 128]
const Types = [Int32Array, Int32Array, Int32Array, Float64Array, Float64Array, Int8Array, Int32Array, Int32Array, Int32Array, Float64Array, Float64Array, Uint32Array, Uint32Array, Int32Array, Float64Array]
let offset = Number(e.__heap_base.value)
const pointers = Types.map((T, index) => { offset = Math.ceil(offset / 8) * 8; const p = offset; offset += lengths[index]! * T.BYTES_PER_ELEMENT; return p })
const pages = Math.ceil(offset / 65536)
if (pages > e.memory.buffer.byteLength / 65536) e.memory.grow(pages - e.memory.buffer.byteLength / 65536)
const v = Types.map((T, index) => new T(e.memory.buffer, pointers[index]!, lengths[index]!))
const [ports, next, hops, x, y, section, reserved, assigned, regionReserved, penalty, best, bestGen, words, positions, distances] = v as any[]
let seed = 0x1337
function rand(): number { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0 }
const edges = [0, -0, Number.MIN_VALUE, -Number.MIN_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE, Infinity, -Infinity, NaN, 2 ** -511, -(2 ** -511), 0.05, -1, 1]
function number(): number { return (rand() & 7) === 0 ? edges[rand() % edges.length]! : (rand() % 2000 - 1000) / 37 }
function reference(start: number, end: number, port: number, goal: number, net: number,
 sx: number, sy: number, g: number, congestion: number, scale: number, generation: number, activeGeneration: number): number[] {
 const result: number[] = []
 if (start === end) return result
 for (let word = start >>> 5; word <= (end - 1) >>> 5; word++) {
  let active = words[word]
  if (word === start >>> 5) active &= 0xffffffff << (start & 31)
  if (word === (end - 1) >>> 5 && (end & 31) !== 0) active &= (1 << (end & 31)) - 1
  while (active !== 0) {
   const bit = active & -active; active ^= bit
   const position = word * 32 + 31 - Math.clz32(bit)
   const p = ports[position]
   if (p === goal) {
    if (reserved[p] === -2 || (reserved[p] !== -1 && reserved[p] !== net)) continue
    if (assigned[p] !== -1 && assigned[p] !== net) continue
    result.push(position, 0)
    return result
   }
   if (p === port || section[p] === 0 || next[position] === -1) continue
   if (reserved[p] === -2 || (reserved[p] !== -1 && reserved[p] !== net)) continue
   if (assigned[p] !== -1 && assigned[p] !== net) continue
   if (regionReserved[next[position]] !== -1 && regionReserved[next[position]] !== net) continue
   const previous = bestGen[hops[position]] === generation ? best[hops[position]] : Infinity
   if (g >= previous) continue
   const base = g + congestion + penalty[p]
   const dx = sx - x[p]; const dy = sy - y[p]
   const distance = Math.sqrt(dx * dx + dy * dy)
   if (base + distance * scale >= previous) continue
   result.push(position, distance)
  }
 }
 return result
}
let assertions = 0, rows = 0, calls = 0
function check(start: number, end: number, port: number, goal: number, net: number,
 sx: number, sy: number, g: number, congestion: number, scale: number, generation: number, activeGeneration: number): void {
 const expected = reference(start, end, port, goal, net, sx, sy, g, congestion, scale, generation, activeGeneration)
 const count = e.scan(...pointers, start, end, port, goal, net, sx, sy, g, congestion, scale, generation)
 expect(count * 2).toBe(expected.length); assertions++
 for (let row = 0; row < count; row++) {
  expect(positions[row]).toBe(expected[row * 2]);
  expect(Object.is(distances[row], expected[row * 2 + 1])).toBe(true); assertions += 2
 }
 rows += count; calls++
}
for (let attempt = 0; attempt < 20000; attempt++) {
 for (let i = 0; i < ports.length; i++) { ports[i] = rand() % 96; next[i] = rand() % 9 - 1; hops[i] = rand() % 192 }
 for (let i = 0; i < x.length; i++) { x[i] = number(); y[i] = number(); penalty[i] = number(); section[i] = rand() % 4; reserved[i] = rand() % 4 - 2; assigned[i] = rand() % 3 - 1 }
 for (let i = 0; i < 8; i++) regionReserved[i] = rand() % 3 - 1
 const gen = [1, 0xffffffff, 42][rand() % 3]!; const activeGen = [1, 0xffffffff, 52][rand() % 3]!
 for (let i = 0; i < best.length; i++) { best[i] = number(); bestGen[i] = (rand() & 1) ? gen : gen - 1 }
 for (let i = 0; i < 4; i++) words[i] = (rand() & 1) ? rand() : 0xffffffff
 const start = rand() % 128; const end = start + rand() % (129 - start)
 check(start, end, rand() % 96, rand() % 96, rand() % 3 - 1, number(), number(), number(), number(), number(), gen, activeGen)
}
// Goal wins before self/mask/next-region filters; blocked goals keep scanning.
ports.fill(2); next.fill(-1); section.fill(0); reserved.fill(-1); assigned.fill(-1); words.fill(0xffffffff)
for (const owner of [-1, 17, 9]) for (const reservation of [-2, -1, 17, 9]) {
 assigned[2] = owner; reserved[2] = reservation
 check(3, 120, 2, 2, 17, 0, 0, 0, 0, 0.05, 1, 1)
}
// Native best updates only decrease, so prerejects stay rejected. Surviving
// repeated incidences must re-read current best before each native visitor.
ports.fill(1); next.fill(0); hops.fill(1); x.fill(1); y.fill(0); section.fill(1); reserved.fill(-1); assigned.fill(-1); regionReserved.fill(-1); penalty.fill(0); best.fill(10); bestGen.fill(1); words.fill(0xffffffff)
check(3, 120, 0, 2, 17, 0, 0, 0, 0, 0.05, 1, 1)
const originalRows = Array.from(positions.subarray(0, 117))
best[1] = 0.01
expect(originalRows).toEqual(Array.from({ length: 117 }, (_, i) => i + 3)); assertions++
expect(reference(3, 120, 0, 2, 17, 0, 0, 0, 0, 0.05, 1, 1)).toEqual([]); assertions++
expect(calls).toBe(20013)
expect(rows).toBeGreaterThan(10000)
expect(assertions).toBeGreaterThan(50000)
})
