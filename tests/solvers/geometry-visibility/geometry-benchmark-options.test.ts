import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { GeometryAutoroutingPipelineSolver, type GeometryAutoroutingPipelineSolverOptions } from "lib/testing/GeometryAutoroutingPipelineSolver"
import type { SimpleRouteJson } from "lib/types"

test("the exact cold benchmark options route and validate the same through-via copper", () => {
  const input: SimpleRouteJson = {
    bounds: { minX: -5, maxX: 5, minY: -4, maxY: 4 }, layerCount: 2, minTraceWidth: 0.2, minViaPadDiameter: 0.5, minViaHoleDiameter: 0.25,
    obstacles: [
      { type: "rect", center: { x: -2, y: 0 }, width: 1, height: 1, layers: ["top"], connectedTo: ["signal", "a"] },
      { type: "rect", center: { x: 2, y: 0 }, width: 1, height: 1, layers: ["bottom"], connectedTo: ["signal", "b"] },
    ],
    connections: [{ name: "signal", nominalTraceWidth: 0.25, pointsToConnect: [{ x: -2, y: 0, layer: "top", pcb_port_id: "a" }, { x: 2, y: 0, layer: "bottom", pcb_port_id: "b" }] }],
  }
  const original = structuredClone(input)
  const options = { cacheProvider: null, effort: 1 } satisfies GeometryAutoroutingPipelineSolverOptions
  const solver = new GeometryAutoroutingPipelineSolver(input, options)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.getConstructorParams()[1]).toEqual(options)
  const traces = solver.getOutputSimplifiedPcbTraces()
  const vias = traces.flatMap((trace) => trace.route.filter((point) => point.route_type === "via"))
  expect(vias).toHaveLength(1)
  expect(vias[0].via_diameter).toBe(0.5)
  expect(vias[0].via_hole_diameter).toBe(0.25)
  const evaluated = evaluateRelaxedDrc({ inputSrj: original, srjWithPointPairs: original, routedTraces: traces, includeBoardClearance: true, drcOptions: { traceClearance: 0.1, includeTraceContinuity: true, includeTypedTraceClearance: true } })
  expect(evaluated.errors).toEqual([])
  const control = new GeometryAutoroutingPipelineSolver(input, { effort: 1 })
  control.solve()
  expect(control.solved).toBe(true)
  expect(traces).toEqual(control.getOutputSimplifiedPcbTraces())
  expect(solver.stats).toEqual(control.stats)
  expect(input).toEqual(original)
  expect(() => new GeometryAutoroutingPipelineSolver(input, { cacheProvider: {} } as unknown as GeometryAutoroutingPipelineSolverOptions)).toThrow("cacheProvider must be null or undefined")
  expect(() => new GeometryAutoroutingPipelineSolver(input, { unexpected: 1 } as GeometryAutoroutingPipelineSolverOptions)).toThrow("does not support option unexpected")
  expect(() => new GeometryAutoroutingPipelineSolver(input, { maxSearchNodes: 0 })).toThrow("maxSearchNodes must be finite and positive")
  expect(() => new GeometryAutoroutingPipelineSolver(input, { maxGeometryQueries: Infinity })).toThrow("maxGeometryQueries must be finite and positive")
  expect(() => new GeometryAutoroutingPipelineSolver(input, { viaCost: -1 })).toThrow("viaCost must be finite and nonnegative")
})
