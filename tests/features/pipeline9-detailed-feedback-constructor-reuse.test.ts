import { expect, test } from "bun:test"
import { DuplicateCongestedPortSolver } from "tiny-hypergraph/lib/index"
import { createDetailedFeedbackFixture } from "../fixtures/detailed-feedback/createDetailedFeedbackFixture"

test("priced replanning clones the completed duplicate topology without hidden independent native solves", (): void => {
  const originalSetup = DuplicateCongestedPortSolver.prototype._setup
  let setupCalls = 0
  DuplicateCongestedPortSolver.prototype._setup = function (): void {
    setupCalls++
    originalSetup.call(this)
  }
  try {
    let preparedBytesBeforeSolve = ""
    const { initialPathingSolver } = createDetailedFeedbackFixture((solver) => {
      preparedBytesBeforeSolve = JSON.stringify(Reflect.get(solver, "detailedFeedbackPreparedGraph"))
    })
    expect(setupCalls).toBe(1)
    const originalGraph = Reflect.get(initialPathingSolver, "detailedFeedbackPreparedGraph")
    const originalBytes = JSON.stringify(originalGraph)
    expect(originalBytes).toBe(preparedBytesBeforeSolve)
    expect(originalGraph.solvedRoutes).toBeUndefined()
    const replan = initialPathingSolver.createDetailedFeedbackReplan(new Map([["0:0", 8]]))
    expect(setupCalls).toBe(1)
    const revisedGraph = Reflect.get(replan, "detailedFeedbackPreparedGraph")
    expect(revisedGraph).not.toBe(originalGraph)
    expect(revisedGraph.ports.map((port: { portId: string }) => port.portId)).toEqual(
      originalGraph.ports.map((port: { portId: string }) => port.portId))
    expect(revisedGraph.regions).toEqual(originalGraph.regions)
    expect(revisedGraph.ports.some((port: { d?: { tinyHypergraphPortPenalty?: number } }) =>
      port.d?.tinyHypergraphPortPenalty === 8)).toBe(true)
    replan.solve()
    expect(replan.solved).toBe(true)
    expect(setupCalls).toBe(1)
    expect(JSON.stringify(originalGraph)).toBe(originalBytes)
    expect(() => initialPathingSolver.createDetailedFeedbackReplan(new Map([["unused", -1]]))).toThrow("Invalid detailed-feedback price")
    expect(() => initialPathingSolver.createDetailedFeedbackReplan(new Map([["0:0", NaN]]))).toThrow("Invalid detailed-feedback price")
  } finally {
    DuplicateCongestedPortSolver.prototype._setup = originalSetup
  }
})
