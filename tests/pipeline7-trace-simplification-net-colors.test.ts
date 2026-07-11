import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "../lib"
import e2e3Fixture from "../fixtures/legacy/assets/e2e3.json"
import type { SimpleRouteJson } from "lib/types"

test("renders completed trace simplification for the e2e3 board with net colors", () => {
  const solver = new AutoroutingPipelineSolver(e2e3Fixture as SimpleRouteJson, {
    visualizationTraceColorMode: "net",
  })
  solver.solveUntilPhase("traceWidthSolver")

  expect(
    solver.visualizeStage(solver.traceSimplificationSolver!),
  ).toMatchGraphicsSvg(import.meta.path)
})
