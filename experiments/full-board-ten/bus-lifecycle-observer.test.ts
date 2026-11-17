import { test, expect } from "bun:test"
import { createBusLifecycleDiagnostics } from "./createBusLifecycleDiagnostics"

const input = { obstacles: [], traces: [], connections: [{ name: "N", pointsToConnect: [{ x: 0, y: 0, layer: "top" }, { x: 1, y: 0, layer: "top" }] }] }

class Lanes {
  input = input
  phase = "validate"
  iterations = 0
  MAX_ITERATIONS = 10
  solved = false
  failed = false
  traces: unknown[] = []
  search: { expanded: number; solved: boolean; failed: boolean } | undefined
  get progress(): never { throw Error("Observer must not invoke routing getters") }
  _step(amount = 1): number {
    this.iterations += amount
    this.phase = this.iterations < 3 ? "route" : "solved"
    if (this.iterations === 1) this.search = { expanded: 4, solved: false, failed: false }
    else if (this.search) { this.search.failed = true; this.search = undefined }
    this.solved = this.iterations >= 3
    return this.iterations
  }
}
class Pipeline {
  input = input
  phase = "route_multi_terminal_buses"
  iterations = 0
  solved = false
  failed = false
  child = new Lanes()
  _step(amount = 1): number {
    this.iterations += amount
    const result = this.child._step(amount)
    if (this.child.solved) { this.solved = true; this.phase = "solved" }
    return result
  }
}

test("bus observer preserves steps, state, exceptions and prototype descriptors", () => {
  const originalPipeline = Object.getOwnPropertyDescriptor(Pipeline.prototype, "_step")!
  const originalLanes = Object.getOwnPropertyDescriptor(Lanes.prototype, "_step")!
  const control = new Pipeline()
  const expectedReturns = [control._step(), control._step(), control._step()]
  const observed = new Pipeline()
  const observer = createBusLifecycleDiagnostics({ pipelineClass: Pipeline, laneClass: Lanes, inputSha256: "fixture" })
  expect([observed._step(), observed._step(), observed._step()]).toEqual(expectedReturns)
  expect(JSON.stringify(observed)).toBe(JSON.stringify(control))
  const result = observer.finish()
  expect(result.captureValid).toBe(true)
  expect(result.calls).toBe(6)
  expect(result.originalCalls).toBe(6)
  expect(result.instances.map((row: any) => [row.kind, row.parentId, row.calls])).toEqual([["pipeline", null, 3], ["lanes", 1, 3]])
  expect(result.instances.map((row: any) => [row.stateSource, row.collected, row.current.solved])).toEqual([["live_reference", false, true], ["live_reference", false, true]])
  expect(result.instances.every((row: any) => !Object.hasOwn(row, "solver") && !Object.hasOwn(row, "solverRef"))).toBe(true)
  expect(result.searchOutcomes).toHaveLength(1)
  expect(result.searchOutcomes[0].failed).toBe(true)
  expect(Object.getOwnPropertyDescriptor(Pipeline.prototype, "_step")).toEqual(originalPipeline)
  expect(Object.getOwnPropertyDescriptor(Lanes.prototype, "_step")).toEqual(originalLanes)
  expect(observer.finish()).toEqual(result)

  const sentinel = new Error("original failure")
  class ThrowingLanes extends Lanes { _step(): never { throw sentinel } }
  const throwingDescriptor = Object.getOwnPropertyDescriptor(ThrowingLanes.prototype, "_step")!
  const throwingObserver = createBusLifecycleDiagnostics({ pipelineClass: Pipeline, laneClass: ThrowingLanes, inputSha256: "throw" })
  let thrown: unknown
  try { new ThrowingLanes()._step() } catch (error) { thrown = error }
  const throwingReport = throwingObserver.finish()
  expect(thrown).toBe(sentinel)
  expect(throwingReport.originalStepExactlyOnce).toBe(true)
  expect(Object.getOwnPropertyDescriptor(ThrowingLanes.prototype, "_step")).toEqual(throwingDescriptor)

  const cappedObserver = createBusLifecycleDiagnostics({ pipelineClass: Pipeline, laneClass: Lanes, inputSha256: "cap" })
  for (let i = 0; i < 130; i++) new Pipeline()._step()
  const cappedReport = cappedObserver.finish()
  expect(cappedReport.calls).toBe(260)
  expect(cappedReport.originalCalls).toBe(260)
  expect(cappedReport.captureValid).toBe(false)
  expect(cappedReport.capped).toContain("instances")

  class BadDiagnosticInput { input = {}; calls = 0; _step(): string { this.calls++; return "untouched" } }
  const invalid = new BadDiagnosticInput()
  const invalidObserver = createBusLifecycleDiagnostics({ pipelineClass: BadDiagnosticInput, laneClass: Lanes, inputSha256: "invalid" })
  expect(invalid._step()).toBe("untouched")
  expect(invalid.calls).toBe(1)
  const invalidReport = invalidObserver.finish()
  expect(invalidReport.captureValid).toBe(false)
  expect(invalidReport.observerErrors).toHaveLength(1)
  expect(invalidReport.originalStepExactlyOnce).toBe(true)
})
