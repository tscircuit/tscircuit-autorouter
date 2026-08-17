import { expect, test } from "bun:test"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { validateAutorouterOutput } from "lib/validation/validate-autorouter-output"

const baseSrj = (): SimpleRouteJson => ({
  layerCount: 2,
  minTraceWidth: 0.1,
  bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
  obstacles: [],
  connections: [],
})

const expectBudgetRefusal = (
  result: ReturnType<typeof validateAutorouterOutput>,
) => {
  expect(result).toEqual({
    valid: false,
    diagnostics: [{ code: "INVALID_SEGMENT", connectionName: "<unknown>" }],
  })
  expect(Object.isFrozen(result)).toBe(true)
  expect(Object.isFrozen(result.diagnostics)).toBe(true)
}

test("fails closed at fixed autorouter output validation ceilings", () => {
  const tooManyConnections = baseSrj()
  tooManyConnections.connections = Array.from({ length: 4097 }, (_, index) => ({
    name: `connection-${index}`,
    pointsToConnect: [],
  }))
  expectBudgetRefusal(
    validateAutorouterOutput({
      inputSrj: tooManyConnections,
      outputSrj: baseSrj(),
    }),
  )

  const tooManyTraces = baseSrj()
  tooManyTraces.traces = Array.from({ length: 257 }, (_, index) => ({
    type: "pcb_trace" as const,
    pcb_trace_id: `trace-${index}`,
    connection_name: "connection",
    route: [],
  }))
  expectBudgetRefusal(
    validateAutorouterOutput({
      inputSrj: baseSrj(),
      outputSrj: tooManyTraces,
    }),
  )

  const oversizedRoute = baseSrj()
  oversizedRoute.traces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "oversized-route",
      connection_name: "connection",
      route: Array.from({ length: 2049 }, (_, index) => ({
        route_type: "wire" as const,
        x: index / 100,
        y: 0,
        width: 0.1,
        layer: "top",
      })),
    } satisfies SimplifiedPcbTrace,
  ]
  expectBudgetRefusal(
    validateAutorouterOutput({
      inputSrj: baseSrj(),
      outputSrj: oversizedRoute,
    }),
  )

  const oversizedRelationSet = baseSrj()
  oversizedRelationSet.traces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "oversized-relations",
      connection_name: "connection",
      connectsTo: Array.from({ length: 257 }, (_, index) => `port-${index}`),
      route: [],
    },
  ]
  expectBudgetRefusal(
    validateAutorouterOutput({
      inputSrj: baseSrj(),
      outputSrj: oversizedRelationSet,
    }),
  )

  const diagnosticFlood = baseSrj()
  diagnosticFlood.traces = Array.from(
    { length: 256 },
    (_, index) =>
      ({
        type: "pcb_trace",
        pcb_trace_id: `invalid-trace-${index}`,
        connection_name: "missing-connection",
        route: [{ route_type: "unsupported" }],
      }) as unknown as SimplifiedPcbTrace,
  )
  expectBudgetRefusal(
    validateAutorouterOutput({
      inputSrj: baseSrj(),
      outputSrj: diagnosticFlood,
    }),
  )

  const obstacleHeavyInput = baseSrj()
  obstacleHeavyInput.connections = [
    {
      name: "connection",
      pointsToConnect: [
        { x: -1, y: 0, layer: "top", pointId: "left" },
        { x: 1, y: 0, layer: "top", pointId: "right" },
      ],
    },
  ]
  obstacleHeavyInput.obstacles = Array.from({ length: 4096 }, (_, index) => ({
    obstacleId: `obstacle-${index}`,
    type: "rect" as const,
    layers: ["top"],
    center: { x: 10_000 + index, y: 10_000 },
    width: 0.1,
    height: 0.1,
    connectedTo: ["connection"],
  }))
  const obstacleHeavyOutput: SimpleRouteJson = {
    ...obstacleHeavyInput,
    obstacles: [],
    traces: Array.from({ length: 256 }, (_, index) => ({
      type: "pcb_trace" as const,
      pcb_trace_id: `valid-trace-${index}`,
      connection_name: "connection",
      connectsTo: ["left", "right"],
      route: [
        { route_type: "wire" as const, x: -1, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire" as const, x: 1, y: 0, width: 0.1, layer: "top" },
      ],
    })),
  }
  expectBudgetRefusal(
    validateAutorouterOutput({
      inputSrj: obstacleHeavyInput,
      outputSrj: obstacleHeavyOutput,
    }),
  )
})
