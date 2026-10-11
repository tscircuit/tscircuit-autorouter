import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "../lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "../lib/types"
import { evaluateConnectionCoverage } from "../scripts/parallel-benchmark/parallelBenchmarkConnectionCoverage"
import { evaluateParallelBenchmarkDrc } from "../scripts/parallel-benchmark/parallelBenchmarkDrc"

test("benchmark DRC rejects physically connected detours outside bounds or the board outline", () => {
  const original: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [],
    connections: [{
      name: "signal",
      pointsToConnect: [
        { x: -3, y: -2, layer: "top", pcb_port_id: "start" },
        { x: -3, y: 2, layer: "top", pcb_port_id: "end" },
      ],
    }],
  }
  const fixtures = [
    { srj: original, detour: { x: 6, y: 0 } },
    {
      srj: {
        ...original,
        outline: [
          { x: -5, y: -5 },
          { x: 5, y: -5 },
          { x: -5, y: 5 },
        ],
      },
      detour: { x: 4, y: 4 },
    },
  ]
  for (const { srj, detour } of fixtures) {
    const trace: SimplifiedPcbTrace = {
      type: "pcb_trace",
      pcb_trace_id: "signal_trace",
      connection_name: "signal",
      connectsTo: ["start", "end"],
      route: [
        { route_type: "wire", x: -3, y: -2, width: 0.1, layer: "top" },
        { route_type: "wire", ...detour, width: 0.1, layer: "top" },
        { route_type: "wire", x: -3, y: 2, width: 0.1, layer: "top" },
      ],
    }
    const input = { inputSrj: srj, srjWithPointPairs: srj, routedTraces: [trace] }
    const omittedBoard = evaluateRelaxedDrc(input)
    expect(omittedBoard.errors).toEqual([])
    expect(omittedBoard.circuitJson.some((element) => element.type === "pcb_board")).toBe(false)
    const omittedCoverage = evaluateConnectionCoverage(srj, omittedBoard.circuitJson)
    expect(omittedCoverage.summary.requiredNetCount).toBe(1)
    expect(omittedCoverage.summary.coveredNetCount).toBe(1)
    expect(omittedCoverage.summary.errorCount).toBe(0)

    const benchmark = evaluateParallelBenchmarkDrc(input)
    const boards = benchmark.circuitJson.filter((element) => element.type === "pcb_board")
    expect(boards).toHaveLength(1)
    expect(boards[0]!.outline).toEqual(srj.outline)
    expect(benchmark.errors.length).toBeGreaterThan(0)
    expect(benchmark.errors.some((error) => error.message.toLowerCase().includes("board"))).toBe(true)
    expect(evaluateConnectionCoverage(srj, benchmark.circuitJson).summary.errorCount).toBe(0)

    const validTrace: SimplifiedPcbTrace = {
      ...trace,
      route: [trace.route[0]!, trace.route.at(-1)!],
    }
    expect(evaluateParallelBenchmarkDrc({ ...input, routedTraces: [validTrace] }).errors).toEqual([])
  }
})
