import { expect, test } from "bun:test"
import { CertifiedDirectAutoroutingPipelineSolver } from "lib/testing/CertifiedDirectAutoroutingPipelineSolver"
import { getCertifiedDirectTestInput } from "tests/fixtures/certified-direct-input"

test("a certified direct tree covers every original terminal at requested width without invoking Pipeline9", async () => {
  const input = getCertifiedDirectTestInput()
  input.connections[0].nominalTraceWidth = 0.35
  input.connections[0].pointsToConnect.push({ x: 1, y: 1, layer: "top", pcb_port_id: "c" })
  input.obstacles = input.connections[0].pointsToConnect.map((point, index) => ({
    type: "rect", center: point, width: 0.4, height: 0.4, layers: ["top"],
    obstacleId: `pad${index}`, connectedTo: [point.pcb_port_id!],
  }))
  const original = JSON.stringify(input)
  const solver = new CertifiedDirectAutoroutingPipelineSolver(input, { cacheProvider: null, effort: 1 })
  expect(solver.selectedStrategy).toBe("certified-direct")
  expect(solver.pipeline9).toBeUndefined()
  expect(() => solver.getOutputSimplifiedPcbTraces()).toThrow("before solve")
  await solver.solveAsync()
  const traces = solver.getOutputSimplifiedPcbTraces()
  expect(traces.length).toBe(2)
  expect(new Set(traces.flatMap((trace) => trace.connectsTo ?? []))).toEqual(new Set(["signal", "a", "b", "c"]))
  expect(traces.every((trace) => trace.route.every((point) => point.route_type === "wire" && point.width === 0.35))).toBe(true)
  expect(solver.stats.pipeline9StagesExecuted).toBe(0)
  expect(solver.stats.searchExpansions).toBe(0)
  expect(solver.stats.acceptedAgainstOriginalInput).toBe(true)
  expect(solver.iterations).toBe(1)
  expect(JSON.stringify(input)).toBe(original)
})
