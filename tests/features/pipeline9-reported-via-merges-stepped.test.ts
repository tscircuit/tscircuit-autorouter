import { expect, spyOn, test } from "bun:test"
import { SameNetViaMergerSolver } from "@tscircuit/trace-simplification-solver"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { Pipeline9ReportedViaMergeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9ReportedViaMergeSolver"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("reported via repairs advance one merger step and retain repeated route pieces", (): void => {
  const routes: HighDensityRoute[] = [0, 0.2].map((y) => ({
    connectionName: "shared-name",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -2, y, z: 0 },
      { x: 0, y, z: 0 },
      { x: 0, y, z: 1 },
      { x: 2, y, z: 1 },
    ],
    vias: [{ x: 0, y }],
  }))
  routes.push({
    connectionName: "untouched",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [{ x: -2, y: 3, z: 0 }, { x: 2, y: 3, z: 0 }],
    vias: [],
  })
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [],
    connections: routes.map((route) => ({
      name: route.connectionName,
      pointsToConnect: [route.route[0]!, route.route.at(-1)!].map((point) => ({
        x: point.x,
        y: point.y,
        layer: point.z === 0 ? "top" : "bottom",
      })),
    })),
  }
  const referenceResult = {
    errors: [{
      type: "pcb_via_clearance_error",
      pcb_trace_ids: ["shared-name"],
    }],
  }
  let validations = 0
  const drcEvaluator: DrcEvaluator = (): ReturnType<DrcEvaluator> => {
    validations++
    return { errors: [] }
  }
  const params = {
    srj,
    routes,
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    drcEvaluator,
    referenceResult,
  }
  const original = structuredClone(routes)
  const solveSpy = spyOn(SameNetViaMergerSolver.prototype, "solve")
    .mockImplementation((): void => {
      throw new Error("Via repairs must advance using step")
    })
  try {
    const solver = new Pipeline9ReportedViaMergeSolver(params)
    expect(solver.merger).toBeUndefined()
    expect(validations).toBe(0)
    expect(() => solver.getResult()).toThrow("not complete")
    solver.step()
    expect(solver.solved).toBe(false)
    expect(solver.merger!.iterations).toBe(0)
    expect(solver.activeSubSolver).toBe(solver.merger)
    expect(validations).toBe(0)
    let mergeIterations = 0
    while (!solver.solved && !solver.failed) {
      const before = solver.merger!.iterations
      solver.step()
      const advanced = solver.merger!.iterations - before
      expect(advanced).toBeGreaterThanOrEqual(0)
      expect(advanced).toBeLessThanOrEqual(1)
      mergeIterations += advanced
    }
    expect(mergeIterations).toBeGreaterThan(1)
    expect(solver.failed).toBe(false)
    expect(validations).toBe(1)
    expect(solveSpy).not.toHaveBeenCalled()
    const result = solver.getResult()
    expect(result.accepted).toBe(true)
    expect(result.referenceValidationCount).toBe(1)
    expect(result.routes).toHaveLength(3)
    expect(result.routes[2]).toBe(routes[2])
    expect(result.routes[0]).not.toBe(result.routes[1])
    for (const [index, route] of result.routes.entries()) {
      expect(route.route[0]).toEqual(original[index]!.route[0])
      expect(route.route.at(-1)).toEqual(original[index]!.route.at(-1))
    }
    expect(result.routes[0]!.vias).toEqual(result.routes[1]!.vias)
    expect(routes).toEqual(original)

    const failing = new Pipeline9ReportedViaMergeSolver(params)
    failing.step()
    failing.merger!.MAX_ITERATIONS = 0
    expect(() => failing.step()).toThrow("Reported via merge failed")
    expect(failing.failed).toBe(true)
    expect(failing.solved).toBe(false)
    expect(() => failing.getResult()).toThrow("not complete")
  } finally {
    solveSpy.mockRestore()
  }
})
