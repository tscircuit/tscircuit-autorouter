import { expect, test } from "bun:test"
import { LocalDrcRepairSolver } from "lib/solvers/LocalDrcRepairSolver/LocalDrcRepairSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { createLocalDrcRepairFixture } from "../fixtures/local-drc-repair-fixture"

test("local cleanup clears independent via and clearance conflicts while an unrelated crossing remains", (): void => {
  for (const offset of [0, 17]) {
    const input = createLocalDrcRepairFixture()
    for (const trace of input.traces) for (const p of trace.route) if ("x" in p) p.x += offset
    for (const connection of input.originalSrj.connections) for (const p of connection.pointsToConnect) p.x += offset
    for (const obstacle of input.originalSrj.obstacles) obstacle.center.x += offset
    input.originalSrj.bounds.minX += offset
    input.originalSrj.bounds.maxX += offset
    if (offset !== 0) {
      input.originalSrj.layerCount = 4
      const points = [
        ...input.traces.flatMap((trace) => trace.route.filter((p) => "x" in p)),
        ...input.originalSrj.connections.flatMap((c) => c.pointsToConnect),
        ...input.originalSrj.obstacles.map((obstacle) => obstacle.center),
      ]
      for (const point of points) {
        const x = point.x
        point.x = -point.y
        point.y = x
      }
      input.originalSrj.bounds = { minX: -30, maxX: 30, minY: -30, maxY: 30 }
    }
    const original = structuredClone(input)
    const solver = new LocalDrcRepairSolver(input)
    solver.solve()
    expect(solver.failed, solver.error ?? "").toBeFalse()
    expect(input).toEqual(original)
    const output = solver.getOutput()
    const { errors } = evaluateRelaxedDrc({ inputSrj: input.originalSrj, srjWithPointPairs: input.srjWithPointPairs, routedTraces: output })
    expect(errors).toHaveLength(1)
    expect(errors[0]!.type).toBe("pcb_trace_error")
    expect(errors[0]!.message).toContain("overlaps")
    expect(solver.stats.mergedViaGroups).toBe(1)
    expect(solver.stats.acceptedClearanceMoves).toBe(1)
    expect(solver.stats.referenceValidationCount).toBe(3)
    for (let i = 0; i < output.length; i++) {
      expect(output[i]!.route[0]).toEqual(original.traces[i]!.route[0])
      expect(output[i]!.route.at(-1)).toEqual(original.traces[i]!.route.at(-1))
      expect(output[i]!.route.map((p) => ({ ...p, x: 0, y: 0 }))).toEqual(
        original.traces[i]!.route.map((p) => ({ ...p, x: 0, y: 0 })),
      )
    }
  }
})
