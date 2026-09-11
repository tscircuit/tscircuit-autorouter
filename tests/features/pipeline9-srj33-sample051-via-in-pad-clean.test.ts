import { expect, test } from "bun:test"
import { getNewViaPadViolations } from "@tscircuit/repair04"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 completes sample051 with permitted small via-in-pad escapes", async (): Promise<void> => {
  // SRJ33 retained sample051 is scenario 32. These explicit fabrication settings
  // define a routable variant; the original dataset's rules remain untouched.
  const { scenario } = await loadScenarioBySampleNumber("srj33", 32)
  const input = {
    ...structuredClone(scenario),
    allowViaInPad: true,
    minViaDiameter: 0.3,
    minViaPadDiameter: 0.3,
    min_via_pad_diameter: 0.3,
    minViaHoleDiameter: 0.15,
    min_via_hole_diameter: 0.15,
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
    effort: 1,
  })

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const traces = solver.getOutputSimplifiedPcbTraces()
  expect(traces).toHaveLength(solver.srjWithPointPairs!.connections.length)
  const { errors } = evaluateRelaxedDrc({
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: traces,
    includeBoardClearance: true,
  })
  expect(errors).toEqual([])

  const routes = solver._getOutputHdRoutes()
  const terminalRoute = routes.find((route) =>
    route.route.some((point) => point.pcb_port_id === "pcb_port_48"),
  )!
  expect(terminalRoute.vias).toContainEqual({ x: 9.8, y: 2.2 })
  expect(terminalRoute.route.at(-1)).toMatchObject({
    x: 9.8,
    y: 2.2,
    z: 0,
    pcb_port_id: "pcb_port_48",
  })
  expect(terminalRoute.route.at(-2)!.z).not.toBe(0)

  // Audit every via, including intermediate copper layers. Same-net contact is
  // allowed by the explicit via-in-pad setting; foreign-pad clearance is not.
  const violations = getNewViaPadViolations({
    srj: {
      ...input,
      connections: [
        ...input.connections,
        ...solver.srjWithPointPairs!.connections,
      ],
    },
    routes,
    previousRoutes: routes.map((route) => ({ ...route, route: [], vias: [] })),
    viaClearance: 0.1,
  }).filter((violation) => {
    const route = routes[violation.routeIndex]!
    const obstacle = input.obstacles[violation.obstacleIndex]!
    const routeNet = solver.connMap.getNetConnectedToId(route.connectionName)
    return !obstacle.connectedTo.some(
      (id) =>
        routeNet !== undefined &&
        solver.connMap.getNetConnectedToId(id) === routeNet,
    )
  })
  expect(violations).toEqual([])
})
