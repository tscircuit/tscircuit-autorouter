import { beforeAll, describe, expect, test } from "bun:test"
import { CapacityMeshSolver } from "lib"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import { checkEachPcbTraceNonOverlapping } from "@tscircuit/checks"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import bugReport from "../../examples/bug-reports/bugreport7-d3f3be/bugreport7-d3f3be.json" assert {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"

const srj = bugReport.simple_route_json as SimpleRouteJson

describe("bug d3f3be1b path simplification", () => {
  let solver: CapacityMeshSolver
  let circuitJson: ReturnType<typeof convertToCircuitJson>
  let pcbSvg: string

  beforeAll(() => {
    solver = new CapacityMeshSolver(srj)
    solver.solve()

    if (solver.failed || !solver.solved) {
      throw new Error(`Solver failed: ${solver.error ?? "unknown"}`)
    }

    const srjWithPointPairs = solver.srjWithPointPairs
    if (!srjWithPointPairs) {
      throw new Error("Solver did not produce point pairs SRJ")
    }

    const simplifiedTraces = solver.getOutputSimplifiedPcbTraces()

    const targetTrace = simplifiedTraces.find(
      (trace) => trace.pcb_trace_id === "source_net_1_mst3_0",
    )

    expect(targetTrace).toBeDefined()
    const lastSegment = targetTrace!.route[targetTrace!.route.length - 1]
    expect(lastSegment).toMatchObject({ x: 1.175, y: -5 })

    circuitJson = convertToCircuitJson(
      srjWithPointPairs,
      simplifiedTraces,
      srj.minTraceWidth,
    )

    pcbSvg = convertCircuitJsonToPcbSvg(circuitJson)
  })

  test("matches expected PCB snapshot", () => {
    expect(pcbSvg).toMatchSvgSnapshot(import.meta.path)
  })

  test("produces routes without DRC violations", () => {
    const errors = checkEachPcbTraceNonOverlapping(circuitJson)
    expect(errors).toHaveLength(0)
  })
})
