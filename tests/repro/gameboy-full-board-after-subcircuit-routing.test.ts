import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver, convertSrjToGraphicsObject } from "lib"
import type { SimpleRouteJson } from "lib/types"
import gameboyBoardSrj from "./assets/gameboy-full-board-after-subcircuit-routing.srj.json" with {
  type: "json",
}

test("routes the full Gameboy board after its child subcircuits are routed", () => {
  const inputSrj = structuredClone(gameboyBoardSrj) as SimpleRouteJson
  const childTraces = inputSrj.traces ?? []

  expect(childTraces).toHaveLength(136)
  expect(
    childTraces.every((trace) => (trace.connectsTo?.length ?? 0) >= 2),
  ).toBe(true)

  const solver = new AutoroutingPipelineSolver(inputSrj)
  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)

  const routedBoardSrj = solver.getOutputSimpleRouteJson()
  const completedBoardSrj: SimpleRouteJson = {
    ...inputSrj,
    traces: [...childTraces, ...(routedBoardSrj.traces ?? [])],
  }

  expect(convertSrjToGraphicsObject(completedBoardSrj)).toMatchGraphicsSvg(
    import.meta.path,
  )
})
