import { expect, test } from "bun:test"
import type { ClearancePathInput } from "@tscircuit/repair04"
import { IncrementalRepairWorkBudget, RetainedHardSpacePotentials } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/incrementalRepair/RetainedHardSpacePotential"

test("hard-space domains use exact current physical values and never opaque mutable prices", () => {
  const work = new IncrementalRepairWorkBudget(1000000)
  const retained = new RetainedHardSpacePotentials(work)
  const route = { connectionName: "wire", rootConnectionName: "net0", traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: 0.5, y: 0.5, z: 0 }, { x: 7.5, y: 3.5, z: 0 }], vias: [] }
  const input: ClearancePathInput = { srj: { layerCount: 4, minTraceWidth: 0.1, bounds: { minX: 0, maxX: 8, minY: 0, maxY: 8 }, connections: [], obstacles: [{ type: "rect", center: { x: 4, y: 4 }, width: 0.5, height: 1, layers: ["top"], connectedTo: ["foreign"] }] }, routes: [route], routeIndex: 0, start: route.route[0]!, end: route.route[1]!, bounds: { minX: 0, maxX: 8, minY: 0, maxY: 8 }, traceThickness: 0.1, traceClearance: 0.1, viaClearance: 0.1, viaHoleDiameter: 0.15 }
  const original = retained.open(input, 1)
  expect(retained.open(structuredClone(input), 1)).toBe(original)
  input.getAdditionalEdgeCost = () => 100
  expect(retained.open(input, 1)).toBe(original)
  input.getAdditionalEdgeCost = () => 0
  expect(retained.open(input, 1)).toBe(original)
  input.srj.obstacles[0]!.width = 0.4
  expect(retained.open(input, 1)).not.toBe(original)
  input.srj.obstacles[0]!.width = 0.5
  expect(retained.open(input, 1)).toBe(original)
  input.srj.allowBlindAndBuriedVias = true
  expect(retained.open(input, 1)).not.toBe(original)
  input.srj.allowBlindAndBuriedVias = false
  expect(retained.open(input, 1)).not.toBe(original)
  delete input.srj.allowBlindAndBuriedVias
  route.rootConnectionName = "net1"
  expect(retained.open(input, 1)).not.toBe(original)
  route.rootConnectionName = "net0"
  route.viaDiameter = 0.4
  expect(retained.open(input, 1)).not.toBe(original)
  route.viaDiameter = 0.3
  input.bounds.minX = -0
  expect(retained.open(input, 1)).not.toBe(original)
  expect(work.counters.workspaceHits).toBe(4)
})
