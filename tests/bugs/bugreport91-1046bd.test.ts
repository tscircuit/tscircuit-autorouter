import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport91-1046bd/bugreport91-1046bd.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport91 keeps every cramped connector escape reachable", () => {
  const solver = new AutoroutingPipelineSolver(structuredClone(srj))

  solver.solveUntilPhase("portPointPathingSolver")
  while (
    solver.getCurrentPhase() === "portPointPathingSolver" &&
    !solver.failed
  ) {
    solver.step()
  }

  expect(solver.getCurrentPhase()).toBe("uniformPortDistributionSolver")
  expect(solver.failed).toBe(false)
  const portPointPathingSolver = solver.portPointPathingSolver
  expect(portPointPathingSolver).toBeDefined()
  expect(portPointPathingSolver?.failed).toBe(false)
  expect(portPointPathingSolver?.solved).toBe(true)
  expect(
    portPointPathingSolver?.stats.duplicateCongestedPortFallbackToOriginal,
  ).toBe(false)
  expect(
    getLastStepSvg(portPointPathingSolver!.visualize()),
  ).toMatchSvgSnapshot(import.meta.path)
})
