import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"

type CoreRoutingPhaseConnection = SimpleRouteConnection & {
  source_trace_id: string
  width: number
}

type CoreRoutingPhaseSimpleRouteJson = SimpleRouteJson & {
  minViaHoleEdgeToViaHoleEdgeClearance: number
  minPlatedHoleDrillEdgeToDrillEdgeClearance: number
  minPadEdgeToPadEdgeClearance: number
}

test("Pipeline9 length-matches the routing-phase differential pair", () => {
  const padPositions = [-7.15, -2.85, 2.85, 7.15].flatMap((x) =>
    [1.905, 0.635, -0.635, -1.905].map((y) => ({ x, y })),
  )
  const connectivityNetIds = [
    0, 3, 38, 39, 40, 41, 42, 43, 0, 44, 45, 46, 47, 3, 48, 49,
  ]
  const obstacles = padPositions.map(({ x, y }, padIndex) => {
    const connectedPair =
      padIndex === 0 || padIndex === 8
        ? { netId: 0, traceId: 0, portIds: [0, 8] }
        : padIndex === 1 || padIndex === 13
          ? { netId: 3, traceId: 1, portIds: [1, 13] }
          : null
    const connectedTo = connectedPair
      ? [
          `pcb_smtpad_${padIndex}`,
          `connectivity_net${connectedPair.netId}`,
          `source_trace_${connectedPair.traceId}`,
          ...connectedPair.portIds.map((portId) => `source_port_${portId}`),
          ...connectedPair.portIds.flatMap((portId) => [
            `pcb_smtpad_${portId}`,
            `pcb_port_${portId}`,
          ]),
        ]
      : [
          `pcb_smtpad_${padIndex}`,
          `connectivity_net${connectivityNetIds[padIndex]}`,
          `source_port_${padIndex}`,
          `pcb_smtpad_${padIndex}`,
          `pcb_port_${padIndex}`,
        ]
    return {
      circuitJsonMetadata: {
        pcb_smtpad_id: `pcb_smtpad_${padIndex}`,
        pcb_port_id: `pcb_port_${padIndex}`,
        source_port_name: `pin${(padIndex % 8) + 1}`,
      },
      componentId: `pcb_component_${Math.floor(padIndex / 8)}`,
      type: "rect" as const,
      layers: ["top"],
      center: { x, y },
      width: 1,
      height: 0.6,
      connectedTo,
    }
  })
  const connections: CoreRoutingPhaseConnection[] = [
    {
      name: "source_trace_0",
      source_trace_id: "source_trace_0",
      nominalTraceWidth: 0.15,
      width: 0.15,
      pointsToConnect: [
        {
          x: -7.15,
          y: 1.905,
          layer: "top",
          pointId: "pcb_port_0",
          pcb_port_id: "pcb_port_0",
        },
        {
          x: 2.85,
          y: 1.905,
          layer: "top",
          pointId: "pcb_port_8",
          pcb_port_id: "pcb_port_8",
        },
      ],
    },
    {
      name: "source_trace_1",
      source_trace_id: "source_trace_1",
      nominalTraceWidth: 0.15,
      width: 0.15,
      pointsToConnect: [
        {
          x: -7.15,
          y: 0.635,
          layer: "top",
          pointId: "pcb_port_1",
          pcb_port_id: "pcb_port_1",
        },
        {
          x: 7.15,
          y: -0.635,
          layer: "top",
          pointId: "pcb_port_13",
          pcb_port_id: "pcb_port_13",
        },
      ],
    },
  ]
  const input: CoreRoutingPhaseSimpleRouteJson = {
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
    obstacles,
    connections,
    differentialPairs: [
      {
        connectionNames: ["source_trace_0", "source_trace_1"],
        lengthTolerance: 0.05,
      },
    ],
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.3,
    minViaHoleDiameter: 0.2,
    minViaPadDiameter: 0.3,
    minTraceToPadEdgeClearance: 0.1,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
    minPlatedHoleDrillEdgeToDrillEdgeClearance: 0.15,
    minPadEdgeToPadEdgeClearance: 0.1,
    minBoardEdgeClearance: 0.2,
    nominalTraceWidth: 0.15,
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input)

  solver.solve()

  const routedLengths = Object.fromEntries(
    (solver.getOutputSimpleRouteJson().traces ?? []).map((trace) => {
      const wires = trace.route.filter((point) => point.route_type === "wire")
      const length = wires.slice(1).reduce((total, point, index) => {
        const previous = wires[index]!
        return total + Math.hypot(point.x - previous.x, point.y - previous.y)
      }, 0)
      return [trace.connection_name, length]
    }),
  )

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(
    Math.abs(routedLengths.source_trace_0! - routedLengths.source_trace_1!),
  ).toBeLessThanOrEqual(0.05)
})
