import { expect, test } from "bun:test"
import { buildTypedRoutingProblem } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/build-typed-routing-problem"
import { compileRoutingRules } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/compile-routing-rules"
import { verifyFinalBoard } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/final-board-verifier"
import { areConnectionTerminalsConnectedByCopper } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/coupled-route-constraints"
import { planGlobalTopology } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/global-topology-planner"
import {
  buildInitialCopperSnapshot,
  TransactionalCopperStore,
} from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/transactional-copper-store"
import type { SimpleRouteJson } from "lib/types"
import { createHybridSegmentTransaction } from "./fixtures"

test("preserves electrical-net identity across sibling routed connections", () => {
  const simpleRouteJson: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaHoleDiameter: 0.2,
    minViaPadDiameter: 0.4,
    defaultObstacleMargin: 0.15,
    bounds: { minX: -5, maxX: 5, minY: -2, maxY: 2 },
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: -4, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["connection_a", "port_a"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["connection_a", "connection_b", "shared_port"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 4, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["connection_b", "port_b"],
      },
    ],
    connections: [
      {
        name: "connection_a",
        pointsToConnect: [
          { x: -4, y: 0, layer: "top", pointId: "port_a" },
          { x: 0, y: 0, layer: "top", pointId: "shared_port" },
        ],
      },
      {
        name: "connection_b",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pointId: "shared_port" },
          { x: 4, y: 0, layer: "top", pointId: "port_b" },
        ],
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "shared_net_trace",
        connection_name: "connection_a",
        connectsTo: ["port_a", "shared_port", "port_b"],
        route: [
          {
            route_type: "wire",
            x: -4,
            y: 0,
            width: 0.15,
            layer: "top",
          },
          {
            route_type: "wire",
            x: 4,
            y: 0,
            width: 0.15,
            layer: "top",
          },
        ],
      },
    ],
  }
  const compiledRules = compileRoutingRules({
    simpleRouteJson,
    routingRules: {
      layerStack: [
        { name: "top", zIndex: 0, preferredDirection: "horizontal" },
        { name: "bottom", zIndex: 1, preferredDirection: "vertical" },
      ],
      legalViaSpans: [{ fromLayer: "top", toLayer: "bottom" }],
      clearances: {
        traceToTraceMm: 0.15,
        traceToPadEdgeMm: 0.15,
        viaToTraceEdgeMm: 0.15,
        viaToPadEdgeMm: 0.15,
        boardEdgeMm: 0.15,
      },
      routingResolutionMm: 0.05,
      routeClasses: [
        {
          className: "signal",
          traceWidthMm: 0.15,
          allowedLayers: ["top", "bottom"],
          viaBudget: { softMaximum: 2, hardMaximum: 4 },
        },
      ],
      connectionClassAssignments: [
        { connectionName: "connection_a", className: "signal" },
        { connectionName: "connection_b", className: "signal" },
      ],
      preloadedCopperOwnership: [
        { pcbTraceId: "shared_net_trace", mutability: "immutable" },
      ],
    },
  })
  const problem = buildTypedRoutingProblem(compiledRules)
  const copperSnapshot = buildInitialCopperSnapshot({ problem })
  const topologyPlan = planGlobalTopology({
    problem,
    maximumEstimatedMemoryBytesPerObject: 16 * 1024 * 1024,
  })
  const finalVerification = verifyFinalBoard({
    problem,
    copperSnapshot,
    maximumViolationCount: 16,
  })
  const store = new TransactionalCopperStore({
    problem,
    maximumTransactionHistory: 4,
  })
  const sharedTerminalCandidate = createHybridSegmentTransaction({
    problem,
    transactionId: "shared-terminal-candidate",
    connectionName: "connection_b",
    start: { x: 0, y: 0 },
    end: { x: 4, y: 0 },
    connectedTerminalIds: ["shared_port", "port_b"],
  })
  const sharedTerminalCommit = store.commit(sharedTerminalCandidate)
  if (sharedTerminalCommit.status !== "committed") {
    throw new Error(sharedTerminalCommit.rejection.message)
  }

  expect(compiledRules.connections[0]?.electricallyConnectedConnectionNames)
    .toEqual(["connection_a", "connection_b"])
  expect(compiledRules.connections[1]?.electricallyConnectedConnectionNames)
    .toEqual(["connection_a", "connection_b"])
  const secondConnection = compiledRules.connections[1]
  if (!secondConnection) throw new Error("missing second compiled connection")
  expect(
    areConnectionTerminalsConnectedByCopper({
      compiledRules,
      copperSnapshot,
      connection: secondConnection,
      firstTerminalId: "shared_port",
      secondTerminalId: "port_b",
    }),
  ).toBe(true)
  expect(topologyPlan.routeObjectPlans).toHaveLength(0)
  expect(finalVerification.status).toBe("verified")
  expect(sharedTerminalCommit.status).toBe("committed")
})
