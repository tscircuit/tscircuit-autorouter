import type { SimpleRouteJson } from "lib/types"
import type { HybridRoutingRulesInput } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/types"

export function createHybridRoutingTestFixture(): {
  simpleRouteJson: SimpleRouteJson
  routingRules: HybridRoutingRulesInput
} {
  const connectionNames = [
    "diff_positive",
    "diff_negative",
    "bus_0",
    "bus_1",
    "power_vcc",
    "signal_plain",
  ]
  const simpleRouteJson: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.12,
    minViaHoleDiameter: 0.2,
    minViaPadDiameter: 0.4,
    bounds: { minX: -10, maxX: 10, minY: -8, maxY: 8 },
    obstacles: [
      {
        obstacleId: "pad_obstacle",
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        connectedTo: ["signal_plain"],
      },
    ],
    connections: connectionNames.map((connectionName, connectionIndex) => ({
      name: connectionName,
      nominalTraceWidth: connectionName === "signal_plain" ? 0.18 : undefined,
      pointsToConnect: [
        {
          x: -8,
          y: connectionIndex - 2.5,
          layer: "top",
          pointId: `${connectionName}_start`,
        },
        {
          x: 8,
          y: connectionIndex - 2.5,
          layer: "top",
          pointId: `${connectionName}_end`,
        },
      ],
    })),
    differentialPairs: [
      {
        connectionNames: ["diff_positive", "diff_negative"],
        lengthTolerance: 0.08,
        traceGap: 0.18,
        maxUncoupledLength: 1.5,
      },
    ],
    buses: [
      {
        busId: "control_bus",
        connectionNames: ["bus_0", "bus_1"],
        maxLengthSkew: 0.25,
        traceWidth: 0.16,
        allowedLayers: ["top", "inner1"],
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "preloaded_signal_plain",
        connection_name: "signal_plain",
        route: [
          {
            route_type: "wire",
            x: -8,
            y: 3.5,
            width: 0.18,
            layer: "top",
          },
          {
            route_type: "via",
            x: -6,
            y: 3.5,
            from_layer: "top",
            to_layer: "bottom",
          },
          {
            route_type: "wire",
            x: -4,
            y: 3.5,
            width: 0.18,
            layer: "bottom",
          },
        ],
      },
    ],
  }
  const routingRules: HybridRoutingRulesInput = {
    layerStack: [
      { name: "top", zIndex: 0, preferredDirection: "horizontal" },
      { name: "inner1", zIndex: 1, preferredDirection: "vertical" },
      { name: "inner2", zIndex: 2, preferredDirection: "horizontal" },
      { name: "bottom", zIndex: 3, preferredDirection: "vertical" },
    ],
    legalViaSpans: [
      { fromLayer: "top", toLayer: "bottom" },
      { fromLayer: "top", toLayer: "inner1" },
      { fromLayer: "inner1", toLayer: "inner2" },
      { fromLayer: "inner2", toLayer: "bottom" },
    ],
    clearances: {
      traceToTraceMm: 0.15,
      traceToPadEdgeMm: 0.15,
      viaToTraceEdgeMm: 0.15,
      viaToPadEdgeMm: 0.15,
      boardEdgeMm: 0.2,
    },
    routingResolutionMm: 0.05,
    routeClasses: [
      {
        className: "signal",
        traceWidthMm: 0.15,
        allowedLayers: ["top", "inner1", "inner2", "bottom"],
        viaBudget: { softMaximum: 3, hardMaximum: 5 },
      },
      {
        className: "power",
        traceWidthMm: 0.4,
        allowedLayers: ["top", "bottom"],
        viaBudget: { softMaximum: 1, hardMaximum: 2 },
      },
    ],
    connectionClassAssignments: connectionNames.map((connectionName) => ({
      connectionName,
      className: connectionName === "power_vcc" ? "power" : "signal",
    })),
    powerRules: [
      {
        connectionName: "power_vcc",
        topology: "tree",
        traceWidthMm: 0.5,
        allowedLayers: ["top", "bottom"],
      },
    ],
    preloadedCopperOwnership: [
      {
        pcbTraceId: "preloaded_signal_plain",
        mutability: "mutable",
        ownerConnectionNames: ["signal_plain"],
      },
    ],
  }
  return { simpleRouteJson, routingRules }
}
