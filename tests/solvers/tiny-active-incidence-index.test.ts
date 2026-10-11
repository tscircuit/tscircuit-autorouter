import { expect, test } from "bun:test"
import { TinyActiveIncidenceIndex } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyActiveIncidenceIndex"

test("active incidence words retain original order, duplicate hops, goals, overflow and search generations", (): void => {
  const ports = Int32Array.from({ length: 141 }, (_, position) => position % 57)
  const hops = Float64Array.from({ length: ports.length }, (_, position) => position % 93)
  const nextRegions = new Int32Array(ports.length).fill(0)
  nextRegions[41] = -1
  const index = new TinyActiveIncidenceIndex(ports, hops, nextRegions, 93)
  expect(index.byteLength).toBeLessThan(1200)
  let seed = 0x9128abcd
  for (let search = 0; search < 16; search++) {
    index.beginSearch()
    const goal = search % 57
    const closed = new Set<number>()
    for (let operation = 0; operation < 70; operation++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const hop = seed % 93
      closed.add(hop)
      index.closeHop(hop, goal)
      index.closeHop(-4, goal)
      for (const [start, end] of [[0, 141], [3, 31], [31, 65], [64, 137], [141, 141]]) {
        const actual: number[] = []
        for (let word = start! >>> 5; word <= ((end! - 1) >>> 5) && start! < end!; word++) {
          let bits = index.getWord(word)
          if (word === (start! >>> 5)) bits &= 0xffffffff << (start! & 31)
          if (word === ((end! - 1) >>> 5) && (end! & 31) !== 0) bits &= (1 << (end! & 31)) - 1
          while (bits !== 0) {
            const bit = bits & -bits
            bits ^= bit
            actual.push(word * 32 + 31 - Math.clz32(bit))
          }
        }
        const expected: number[] = []
        for (let position = start!; position < end!; position++) {
          if (nextRegions[position] === -1 || ports[position] === goal || !closed.has(hops[position]!)) expected.push(position)
        }
        expect(actual).toEqual(expected)
      }
    }
  }
  ;(index as unknown as { generation: number }).generation = 0xffffffff
  index.beginSearch()
  expect(index.getWord(0)).toBe(0xffffffff)
  index.closeHop(31, -1)
  expect(index.getWord(0) & 0x80000000).toBe(0)
  expect(() => index.closeHop(94, -1)).toThrow("invalid directed hop")
})
