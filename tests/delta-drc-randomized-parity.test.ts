import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "high-density-repair03/lib"
import { DeltaAutoroutingDrcEngine } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/DeltaAutoroutingDrcEngine"
import { deltaDrcSyntheticBoard, syntheticVia, syntheticWire } from "./fixtures/deltaDrcSynthetic"

test("delta DRC matches every first/worst error and target through seeded multiway mutation sequences", () => {
  let seed = 71143
  const rand = (): number => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
  const traces = Array.from({ length: 14 }, (_, i) => i % 2 ? syntheticWire(`t${i}`, ["a", "b", "c"][i % 3]!, rand() * 2 - 1, rand() * 2 - 1) : syntheticVia(`t${i}`, ["a", "b", "c"][i % 3]!, rand() * 2 - 1, rand() * 2 - 1))
  for (const blind of [false, true]) {
    const board = { ...deltaDrcSyntheticBoard, allowBlindAndBuriedVias: blind }
    const options = { spatialCellSize: 0.3, includeTraceViaOwnerMetadata: true }
    const full = new AutoroutingDrcEngine(board, options)
    const delta = new DeltaAutoroutingDrcEngine(board, options)
    for (let iteration = 0; iteration < 240; iteration++) {
      const index = Math.floor(rand() * traces.length)
      const route = traces[index]!
      const point = route.route[Math.floor(rand() * route.route.length)]!
      if (point.route_type === "jumper") throw new Error("Unexpected synthetic jumper")
      point.x += (rand() - 0.5) * 0.7
      point.y += (rand() - 0.5) * 0.7
      if (point.route_type === "wire" && iteration % 7 === 0) point.layer = ["top", "inner1", "bottom"][iteration % 3]!
      if (iteration % 13 === 0) traces.reverse()
      if (iteration % 17 === 0) route.connection_name = ["a", "b", "c"][iteration % 3]!
      if (iteration % 19 === 0) traces[index] = structuredClone(traces[(index + 1) % traces.length]!)
      if (iteration % 23 === 0) route.route.reverse()
      expect(delta.evaluate(traces)).toEqual(full.evaluate(traces))
      if (iteration % 3 === 0) expect(delta.evaluateLegacy(traces)).toEqual(full.evaluateLegacy(traces))
    }
    expect(delta.deltaStats.deltaDrcReusedQueries).toBeGreaterThan(0)
  }
})
