import { beforeAll, describe, expect, test } from "bun:test"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { CapacityMeshSolver } from "lib"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import bugReport from "../../examples/bug-reports/bugreport8-e3ec95/bugreport8-e3ec95.json" assert {
  type: "json",
}

const srj = bugReport.simple_route_json as SimpleRouteJson

describe("bugreport8-e3ec95", () => {
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
})
