import { expect, test } from "bun:test"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"

class ExternalTerminalSolver {}

test("high density solver metadata handles child solvers without getSolverName", () => {
  const solver = new HighDensitySolver({
    nodePortPoints: [],
  })

  expect(
    (solver as any).getConcreteSolverTypeName(new ExternalTerminalSolver()),
  ).toBe("ExternalTerminalSolver")
  expect((solver as any).getConcreteSolverTypeName(null)).toBe("unknown")
})
