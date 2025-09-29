import { beforeAll, describe, expect, test } from "bun:test"
import { checkEachPcbTraceNonOverlapping } from "@tscircuit/checks"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import type { AnyCircuitElement } from "circuit-json"
import keyboard4 from "../examples/legacy/assets/keyboard4.json"
import { CapacityMeshSolver } from "../lib"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"

describe("keyboard4 autorouting", () => {
  const keyboard4Srj = keyboard4 as unknown as SimpleRouteJson

  let circuitJson: AnyCircuitElement[]
  let pcbSvg: string

  beforeAll(() => {
    const solver = new CapacityMeshSolver(keyboard4Srj)
    solver.solve()

    if (solver.failed || !solver.solved) {
      throw new Error(`Keyboard4 solver failed: ${solver.error ?? "unknown"}`)
    }

    const srjWithPointPairs = solver.srjWithPointPairs
    if (!srjWithPointPairs) {
      throw new Error("Keyboard4 solver did not produce point pairs SRJ")
    }

    const simplifiedTraces = solver.getOutputSimplifiedPcbTraces()

    circuitJson = convertToCircuitJson(
      srjWithPointPairs,
      simplifiedTraces,
      keyboard4Srj.minTraceWidth,
    )

    pcbSvg = convertCircuitJsonToPcbSvg(circuitJson)
  })

  test("matches the expected PCB snapshot", () => {
    expect(pcbSvg).toMatchSvgSnapshot(import.meta.path)
  })

  test("produces routes without DRC violations", () => {
    const errors = checkEachPcbTraceNonOverlapping(circuitJson)
    expect(errors).toHaveLength(0)
  })
})
