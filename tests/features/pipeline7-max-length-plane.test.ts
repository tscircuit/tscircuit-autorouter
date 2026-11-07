import { expect, test } from "bun:test"
import { measureRouteConstraint } from "lib/solvers/ConstrainedRouteSolver/measureRouteConstraint"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import {
  createPipeline7LengthInput,
  getPipeline7LengthSnapshot,
} from "tests/fixtures/pipeline7-max-length"

test("Pipeline7 enforces a ground-plane connection budget", async (): Promise<void> => {
  const input = createPipeline7LengthInput(4, true)
  const original = structuredClone(input)
  const solver = new AutoroutingPipelineSolver7_MultiGraph(input, {
    cacheProvider: null,
    effort: 0.1,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  const traces = solver.getOutputSimplifiedPcbTraces()
  // A through-via already consumes the default 1.6 mm travel budget,
  // before the surface stub. The 1 mm rule therefore cannot be satisfied.
  const planeVias = traces
    .flatMap((trace) => trace.route)
    .filter(
      (point) => point.route_type === "via" && point.to_layer === "inner1",
    )
  expect(planeVias.length).toBeGreaterThan(0)
  expect(input).toEqual(original)
  const rule = input.routeConstraints![0]!
  const measured = measureRouteConstraint(input, traces, rule)
  expect(measured.satisfied).toBe(true)
  expect(measured.length).toBeCloseTo(1.9)
  expect(measured.vias).toBe(1)
  const wrongNet = structuredClone(input)
  wrongNet.obstacles[0]!.connectedTo = ["UNRELATED"]
  expect(measureRouteConstraint(wrongNet, traces, rule).satisfied).toBe(false)
  const wrongLayer = structuredClone(input)
  wrongLayer.obstacles[0]!.layers = ["inner2"]
  expect(measureRouteConstraint(wrongLayer, traces, rule).satisfied).toBe(false)

  const tight = new AutoroutingPipelineSolver7_MultiGraph(
    createPipeline7LengthInput(1, true),
    { cacheProvider: null, effort: 0.1 },
  )
  tight.solve()
  expect(tight.solved).toBe(false)
  expect(tight.failed).toBe(true)
  await expect(
    getPipeline7LengthSnapshot(
      input,
      solver.srjWithPointPairs!,
      traces,
      `GND plane: 1 mm limit ${tight.solved ? "ACCEPTED" : "REJECTED"}`,
    ),
  ).toMatchSvgSnapshot(import.meta.path)
})
