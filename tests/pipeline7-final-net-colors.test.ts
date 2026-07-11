import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "../lib"
import e2e3Fixture from "../fixtures/legacy/assets/e2e3.json"
import type { SimpleRouteJson } from "lib/types"

test("renders the final routed e2e3 output with Pipeline 7 net colors", () => {
  const solver = new AutoroutingPipelineSolver(e2e3Fixture as SimpleRouteJson, {
    visualizationTraceColorMode: "net",
  })
  solver.solve()

  expect(solver.visualizeFinalOutput()).toMatchGraphicsSvg(import.meta.path)
})
