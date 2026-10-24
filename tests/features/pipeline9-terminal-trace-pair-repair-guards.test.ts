import { expect, test } from "bun:test"
import { applyPipeline9TerminalTracePairRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9TerminalTracePairRepairs"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("terminal trace-pair search rejects disconnected candidates and preserves its inputs", (): void => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "a",
      traceThickness: 0.15,
      viaDiameter: 0.45,
      route: [
        { x: 0.5, y: 0.8, z: 0 },
        { x: 0.1, y: 0.2, z: 0 },
        { x: 0, y: -0.4, z: 0, pcb_port_id: "port_a" },
      ],
      vias: [],
    },
    {
      connectionName: "b",
      traceThickness: 0.15,
      viaDiameter: 0.45,
      route: [
        { x: -1, y: 0.5, z: 0 },
        { x: -0.2, y: 0.2, z: 0 },
        { x: 0, y: 0, z: 0, pcb_port_id: "port_b" },
      ],
      vias: [],
    },
  ]
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    connections: routes.map((route) => ({
      name: route.connectionName,
      pointsToConnect: [],
    })),
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.208,
        height: 0.208,
        layers: ["top"],
        connectedTo: ["port_b"],
      },
    ],
  }
  const errors = [
    {
      type: "pcb_trace_error",
      pcb_trace_id: "a_0",
      pcb_trace_error_id: "overlap_a_0_b_0",
      center: { x: 0, y: 0.1 },
    },
    {
      type: "pcb_trace_error",
      pcb_trace_id: "a_0",
      pcb_trace_error_id: "overlap_a_0_pcb_smtpad_0.000_0.000",
      center: { x: 0, y: 0 },
    },
  ]
  const original = structuredClone({ srj, routes })
  let evaluations = 0
  const params = {
    originalSrj: srj,
    routes,
    newConnections: srj.connections,
    syntheticConnectionNames: new Set<string>(),
    initialErrors: errors,
    drcEvaluator: (): typeof errors => {
      evaluations++
      // A candidate with fewer findings is still invalid when it disconnects.
      return [
        {
          type: "pcb_trace_error",
          pcb_trace_id: "b_0",
          pcb_trace_error_id: "missing_connection_b_0",
          center: { x: 0, y: 0 },
        },
      ]
    },
  }
  const rejected = applyPipeline9TerminalTracePairRepairs(params)
  expect(rejected.repaired).toBeFalse()
  expect(rejected.routes).toBe(routes)
  expect(evaluations).toBeGreaterThan(0)
  expect(evaluations).toBeLessThanOrEqual(64)
  expect(rejected.validationCount).toBe(evaluations)
  expect({ srj, routes }).toEqual(original)

  evaluations = 0
  for (const changes of [
    { initialErrors: [] },
    { initialErrors: Array.from({ length: 9 }, () => errors[0]!) },
    { syntheticConnectionNames: new Set(["b"]) },
    {
      originalSrj: {
        ...srj,
        obstacles: [{ ...srj.obstacles[0]!, ccwRotationDegrees: 45 }],
      },
    },
    {
      originalSrj: {
        ...srj,
        obstacles: [{ ...srj.obstacles[0]!, layers: ["bottom"] }],
      },
    },
  ]) {
    const result = applyPipeline9TerminalTracePairRepairs({
      ...params,
      ...changes,
    })
    expect(result.routes).toBe(routes)
    expect(result.repaired).toBeFalse()
  }
  expect(evaluations).toBe(0)
})
