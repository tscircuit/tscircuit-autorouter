import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "high-density-repair03/lib"
import { DeltaAutoroutingDrcEngine } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/DeltaAutoroutingDrcEngine"
import { deltaDrcSyntheticBoard, syntheticWire } from "./fixtures/deltaDrcSynthetic"

test("one local mutation keeps distant dynamic index entries and query ledgers intact", () => {
  const traces = Array.from({ length: 80 }, (_, i) => syntheticWire(`t${i}`, `net${i}`, i * 2, 4))
  const full = new AutoroutingDrcEngine(deltaDrcSyntheticBoard)
  const delta = new DeltaAutoroutingDrcEngine(deltaDrcSyntheticBoard, { spatialCellSize: 0.5 })
  expect(delta.evaluate(traces)).toEqual(full.evaluate(traces))
  const before = { ...delta.deltaStats }
  const moved = traces[40]!.route[0]!
  if (moved.route_type === "jumper") throw new Error("Unexpected synthetic jumper")
  moved.y += 0.05
  expect(delta.evaluate(traces)).toEqual(full.evaluate(traces))
  expect(delta.deltaStats.deltaDrcCompiledTraces - before.deltaDrcCompiledTraces).toBe(1)
  expect(delta.deltaStats.deltaDrcReusedTraces - before.deltaDrcReusedTraces).toBe(79)
  expect(delta.deltaStats.deltaDrcInsertedPrimitives - before.deltaDrcInsertedPrimitives).toBe(1)
  expect(delta.deltaStats.deltaDrcRemovedPrimitives - before.deltaDrcRemovedPrimitives).toBe(1)
  expect(delta.deltaStats.deltaDrcTouchedQueries - before.deltaDrcTouchedQueries).toBe(1)
  expect(delta.deltaStats.deltaDrcReusedQueries - before.deltaDrcReusedQueries).toBe(79)
  const beforeBend = { ...delta.deltaStats }
  traces[0]!.route.splice(1, 0, { route_type: "wire", x: 0, y: 4.05, width: 0.1, layer: "top" })
  expect(delta.evaluate(traces)).toEqual(full.evaluate(traces))
  expect(delta.deltaStats.deltaDrcInsertedPrimitives - beforeBend.deltaDrcInsertedPrimitives).toBe(2)
  expect(delta.deltaStats.deltaDrcRemovedPrimitives - beforeBend.deltaDrcRemovedPrimitives).toBe(1)
  expect(delta.deltaStats.deltaDrcReusedQueries - beforeBend.deltaDrcReusedQueries).toBe(79)
})
