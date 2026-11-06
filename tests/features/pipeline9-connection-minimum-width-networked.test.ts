import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_Networked } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/AutoroutingPipelineSolver9_Networked"
import { ExampleHdCache2Server } from "tests/fixtures/example-hd-cache2-server"
import { getConnectionMinimumTraceWidthInput } from "../fixtures/connectionMinimumTraceWidthInput"

test("networked Pipeline9 sends each constrained node's minimum to the solver", async (): Promise<void> => {
  const requestedWidths: number[] = []
  const server = new ExampleHdCache2Server({ beforeSolve: (request): void => {
    requestedWidths.push(request.input.traceWidth)
  } })
  try {
    const solver = new AutoroutingPipelineSolver9_Networked(getConnectionMinimumTraceWidthInput(), {
      cacheProvider: null, hdCache2ServerUrl: server.url,
    })
    await solver.solveAsync()
    expect(solver.error).toBeNull()
    expect(solver.solved).toBe(true)
    expect(requestedWidths.length).toBeGreaterThan(0)
    expect(requestedWidths.every((width) => width >= 0.4)).toBe(true)
    const wires = solver.getOutputSimplifiedPcbTraces().flatMap((trace) => trace.route.filter((point) => point.route_type === "wire"))
    expect(wires.length).toBeGreaterThan(0)
    expect(wires.every((point) => point.width >= 0.4 - 1e-6)).toBe(true)
  } finally {
    await server.close()
  }
})
