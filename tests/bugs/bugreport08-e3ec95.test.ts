import { beforeAll, describe, expect, test } from "bun:test"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { CapacityMeshSolver } from "lib"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import bugReport from "../../examples/bug-reports/bugreport08-e3ec95/bugreport08-e3ec95.json" assert {
  type: "json",
}
const srj = bugReport.simple_route_json as SimpleRouteJson

describe("bugreport8-e3ec95", () => {
  let solver: CapacityMeshSolver
  let circuitJson: ReturnType<typeof convertToCircuitJson>
  let pcbSvg: string

  test.skip("matches expected PCB snapshot", () => {
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

    const layersUsed = new Set(
      circuitJson
        .filter((e) => e.type === "pcb_trace")
        .flatMap((t) => t.route)
        .flatMap((r) =>
          r.route_type === "via" ? [r.from_layer, r.to_layer] : [],
        ),
    )

    expect(layersUsed.size).toBe(4)

    pcbSvg = convertCircuitJsonToPcbSvg(circuitJson)
    expect(pcbSvg).toMatchSvgSnapshot(import.meta.path)
  })
})
