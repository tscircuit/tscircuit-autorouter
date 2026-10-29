import { expect, test } from "bun:test"
import { DuplicateCongestedPortSolver } from "tiny-hypergraph/lib/index"
import { createGeometryFeedbackPlanningFixture } from "../fixtures/pipeline9-geometry-feedback-fixture"

test("certified replanning removes actual source duplicates without another native estimation search", (): void => {
  const originalSolve = DuplicateCongestedPortSolver.prototype.solve
  let calls = 0
  DuplicateCongestedPortSolver.prototype.solve = function (this: DuplicateCongestedPortSolver): void {
    calls++
    originalSolve.call(this)
  }
  try {
    const { pipeline, feedback } = createGeometryFeedbackPlanningFixture({ secondConnection: true })
    expect(calls).toBe(1)
    const primary = pipeline.portPointPathingSolver!
    expect(primary.stats.duplicateCongestedPortCount).toBeGreaterThan(0)
    const originalOutput = primary.getOutput()
    feedback.step()
    const internal = feedback.pathingSolver as unknown as {
      tinyPipelineSolver: { getSolver<T>(name: string): T | undefined }
    }
    type Loaded = { topology: { portMetadata?: Array<{ serializedPortId?: string; duplicatedFromPortId?: string }> } }
    let loaded: Loaded | undefined
    for (let step = 0; step < 20 && !loaded; step++) {
      feedback.step()
      loaded = internal.tinyPipelineSolver.getSolver<Loaded>("solveGraph")
    }
    expect(loaded).toBeDefined()
    expect(calls).toBe(1)
    expect(pipeline.geometryFeedbackStats.replans).toBe(1)
    const ports = loaded!.topology.portMetadata!
    expect(ports.some((port) => port.serializedPortId?.startsWith("port_1::0"))).toBeFalse()
    expect(ports.some((port) => port.duplicatedFromPortId === "port_1::0")).toBeFalse()
    expect(ports.some((port) => port.serializedPortId === "upper_port_0::0")).toBeTrue()
    expect(ports.some((port) => port.serializedPortId === "upper_port_1::0")).toBeTrue()
    expect(primary.getOutput()).toEqual(originalOutput)
  } finally {
    DuplicateCongestedPortSolver.prototype.solve = originalSolve
  }
})
