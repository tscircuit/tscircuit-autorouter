import { expect, test } from "bun:test"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { validateAutorouterOutput } from "lib/validation/validate-autorouter-output"

const wireTrace = ({
  traceId,
  connectionName,
  connectsTo,
  start,
  end,
  layer = "top",
  replaces,
}: {
  traceId: string
  connectionName: string
  connectsTo: [string, string]
  start: { x: number; y: number }
  end: { x: number; y: number }
  layer?: string
  replaces?: string
}): SimplifiedPcbTrace => ({
  type: "pcb_trace",
  pcb_trace_id: traceId,
  ...(replaces ? { __replaces_pcb_trace_id: replaces } : {}),
  connection_name: connectionName,
  connectsTo,
  route: [
    { route_type: "wire", ...start, width: 0.1, layer },
    { route_type: "wire", ...end, width: 0.1, layer },
  ],
})

const createInput = (): SimpleRouteJson => ({
  layerCount: 2,
  minTraceWidth: 0.1,
  bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
  obstacles: [],
  connections: [
    {
      name: "horizontal",
      pointsToConnect: [
        { x: -4, y: 0, layer: "top", pointId: "h-left" },
        { x: 4, y: 0, layer: "top", pointId: "h-right" },
      ],
    },
    {
      name: "vertical",
      pointsToConnect: [
        { x: 0, y: -4, layer: "top", pointId: "v-bottom" },
        { x: 0, y: 4, layer: "top", pointId: "v-top" },
      ],
    },
  ],
})

test("validates complete autorouter output topology without claiming clearance", () => {
  const inputSrj = createInput()
  const crossingOutput: SimpleRouteJson = {
    ...inputSrj,
    traces: [
      wireTrace({
        traceId: "trace-horizontal",
        connectionName: "horizontal",
        connectsTo: ["h-left", "h-right"],
        start: { x: -4, y: 0 },
        end: { x: 4, y: 0 },
      }),
      wireTrace({
        traceId: "trace-vertical",
        connectionName: "vertical",
        connectsTo: ["v-bottom", "v-top"],
        start: { x: 0, y: -4 },
        end: { x: 0, y: 4 },
      }),
    ],
  }
  const crossing = validateAutorouterOutput({
    inputSrj,
    outputSrj: crossingOutput,
  })
  expect(crossing.valid).toBe(false)
  expect(crossing.diagnostics).toEqual([
    {
      code: "DIFFERENT_CONNECTION_SAME_LAYER_CROSSING",
      connectionName: "horizontal",
      traceId: "trace-horizontal",
      peerConnectionName: "vertical",
      peerTraceId: "trace-vertical",
      layer: "top",
      segmentIndex: 0,
      peerSegmentIndex: 0,
      coordinate: { x: 0, y: 0 },
    },
  ])
  expect(Object.isFrozen(crossing)).toBe(true)
  expect(Object.isFrozen(crossing.diagnostics)).toBe(true)

  const differentLayerInput = createInput()
  differentLayerInput.connections[1]!.pointsToConnect = [
    { x: 0, y: -4, layer: "bottom", pointId: "v-bottom" },
    { x: 0, y: 4, layer: "bottom", pointId: "v-top" },
  ]
  const differentLayerOutput: SimpleRouteJson = {
    ...differentLayerInput,
    traces: [
      crossingOutput.traces![0]!,
      wireTrace({
        traceId: "trace-vertical",
        connectionName: "vertical",
        connectsTo: ["v-bottom", "v-top"],
        start: { x: 0, y: -4 },
        end: { x: 0, y: 4 },
        layer: "bottom",
      }),
    ],
  }
  expect(
    validateAutorouterOutput({
      inputSrj: differentLayerInput,
      outputSrj: differentLayerOutput,
    }),
  ).toEqual({ valid: true, diagnostics: [] })

  const preloadedInput = createInput()
  preloadedInput.traces = [
    wireTrace({
      traceId: "old-horizontal",
      connectionName: "horizontal",
      connectsTo: ["h-left", "h-right"],
      start: { x: -4, y: 0 },
      end: { x: 4, y: 0 },
    }),
  ]
  preloadedInput.connections[1]!.pointsToConnect = [
    { x: 0, y: -4, layer: "bottom", pointId: "v-bottom" },
    { x: 0, y: 4, layer: "bottom", pointId: "v-top" },
  ]
  const replacementOutput: SimpleRouteJson = {
    ...preloadedInput,
    traces: [
      wireTrace({
        traceId: "new-horizontal",
        connectionName: "horizontal",
        connectsTo: ["h-left", "h-right"],
        start: { x: -4, y: 0 },
        end: { x: 4, y: 0 },
        replaces: "old-horizontal",
      }),
      wireTrace({
        traceId: "trace-vertical-bottom",
        connectionName: "vertical",
        connectsTo: ["v-bottom", "v-top"],
        start: { x: 0, y: -4 },
        end: { x: 0, y: 4 },
        layer: "bottom",
      }),
    ],
  }
  expect(
    validateAutorouterOutput({
      inputSrj: preloadedInput,
      outputSrj: replacementOutput,
    }).valid,
  ).toBe(true)

  const completeOutputWithPreload: SimpleRouteJson = {
    ...preloadedInput,
    traces: [
      preloadedInput.traces![0]!,
      wireTrace({
        traceId: "trace-vertical-bottom",
        connectionName: "vertical",
        connectsTo: ["v-bottom", "v-top"],
        start: { x: 0, y: -4 },
        end: { x: 0, y: 4 },
        layer: "bottom",
      }),
    ],
  }
  expect(
    validateAutorouterOutput({
      inputSrj: preloadedInput,
      outputSrj: completeOutputWithPreload,
    }).valid,
  ).toBe(true)

  const unknownLayer = structuredClone(crossingOutput)
  ;(unknownLayer.traces![0]!.route[0] as { layer: string }).layer = "inner9"
  expect(
    validateAutorouterOutput({
      inputSrj,
      outputSrj: unknownLayer,
    }).diagnostics.some((diagnostic) => diagnostic.code === "UNKNOWN_LAYER"),
  ).toBe(true)

  const disconnected = structuredClone(crossingOutput)
  ;(disconnected.traces![0]!.route[0] as { x: number }).x = -3
  expect(
    validateAutorouterOutput({
      inputSrj,
      outputSrj: disconnected,
    }).diagnostics.some(
      (diagnostic) => diagnostic.code === "DISCONNECTED_ROUTE_ENDPOINT",
    ),
  ).toBe(true)

  const unknownConnection = structuredClone(crossingOutput)
  unknownConnection.traces![0]!.connection_name = "not-a-connection"
  unknownConnection.traces![0]!.connectsTo = []
  expect(
    validateAutorouterOutput({
      inputSrj,
      outputSrj: unknownConnection,
    }).diagnostics.some(
      (diagnostic) => diagnostic.code === "UNKNOWN_CONNECTION",
    ),
  ).toBe(true)

  const viaInput: SimpleRouteJson = {
    ...inputSrj,
    connections: [
      {
        name: "horizontal",
        pointsToConnect: [
          { x: -4, y: 0, layer: "top", pointId: "h-left" },
          { x: 4, y: 0, layer: "bottom", pointId: "h-right" },
        ],
      },
    ],
  }
  const viaOutput: SimpleRouteJson = {
    ...viaInput,
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "trace-with-via",
        connection_name: "horizontal",
        connectsTo: ["h-left", "h-right"],
        route: [
          { route_type: "wire", x: -4, y: 0, width: 0.1, layer: "top" },
          { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
          {
            route_type: "via",
            x: 0,
            y: 0,
            from_layer: "top",
            to_layer: "bottom",
          },
          { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "bottom" },
          { route_type: "wire", x: 4, y: 0, width: 0.1, layer: "bottom" },
        ],
      },
    ],
  }
  expect(
    validateAutorouterOutput({ inputSrj: viaInput, outputSrj: viaOutput }),
  ).toEqual({
    valid: true,
    diagnostics: [],
  })

  const terminalViaOutput = structuredClone(viaOutput)
  terminalViaOutput.traces![0]!.route = [
    { route_type: "via", x: -4, y: 0, from_layer: "bottom", to_layer: "top" },
    { route_type: "wire", x: -4, y: 0, width: 0.1, layer: "top" },
    { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
    { route_type: "via", x: 0, y: 0, from_layer: "top", to_layer: "bottom" },
    { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "bottom" },
    { route_type: "wire", x: 4, y: 0, width: 0.1, layer: "bottom" },
    { route_type: "via", x: 4, y: 0, from_layer: "bottom", to_layer: "top" },
  ]
  expect(
    validateAutorouterOutput({
      inputSrj: viaInput,
      outputSrj: terminalViaOutput,
    }).valid,
  ).toBe(true)

  const peerViaOutput: SimpleRouteJson = {
    ...viaInput,
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "trace-to-peer-via",
        connection_name: "horizontal",
        connectsTo: ["h-left", "junction"],
        route: [
          { route_type: "wire", x: -4, y: 0, width: 0.1, layer: "top" },
          { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
        ],
      },
      {
        type: "pcb_trace",
        pcb_trace_id: "trace-from-peer-via",
        connection_name: "horizontal",
        connectsTo: ["junction", "h-right"],
        route: [
          {
            route_type: "via",
            x: 0,
            y: 0,
            from_layer: "top",
            to_layer: "bottom",
          },
          { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "bottom" },
          { route_type: "wire", x: 4, y: 0, width: 0.1, layer: "bottom" },
        ],
      },
    ],
  }
  expect(
    validateAutorouterOutput({ inputSrj: viaInput, outputSrj: peerViaOutput })
      .valid,
  ).toBe(true)

  const innerLayerViaInput: SimpleRouteJson = {
    ...viaInput,
    layerCount: 4,
    connections: [
      {
        name: "horizontal",
        pointsToConnect: [
          { x: -4, y: 0, layer: "top", pointId: "h-left" },
          { x: 4, y: 0, layer: "inner1", pointId: "h-right" },
        ],
      },
    ],
  }
  const innerLayerViaOutput: SimpleRouteJson = {
    ...innerLayerViaInput,
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "trace-through-inner-layer",
        connection_name: "horizontal",
        connectsTo: ["h-left", "h-right"],
        route: [
          { route_type: "wire", x: -4, y: 0, width: 0.1, layer: "top" },
          { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
          {
            route_type: "via",
            x: 0,
            y: 0,
            from_layer: "top",
            to_layer: "bottom",
          },
          { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "inner1" },
          { route_type: "wire", x: 4, y: 0, width: 0.1, layer: "inner1" },
        ],
      },
    ],
  }
  expect(
    validateAutorouterOutput({
      inputSrj: innerLayerViaInput,
      outputSrj: innerLayerViaOutput,
    }),
  ).toEqual({ valid: true, diagnostics: [] })

  const unsupported = structuredClone(viaOutput)
  unsupported.traces![0]!.route[2] = {
    route_type: "jumper",
    start: { x: 0, y: 0 },
    end: { x: 1, y: 0 },
    footprint: "0603",
    layer: "top",
  }
  expect(
    validateAutorouterOutput({
      inputSrj: viaInput,
      outputSrj: unsupported,
    }).diagnostics.some((diagnostic) => diagnostic.code === "INVALID_SEGMENT"),
  ).toBe(true)

  const throughObstacle = structuredClone(viaOutput)
  throughObstacle.traces![0]!.route[2] = {
    route_type: "through_obstacle",
    start: { x: 0, y: 0 },
    end: { x: 0, y: 0 },
    from_layer: "top",
    to_layer: "bottom",
    width: 0.1,
  }
  expect(
    validateAutorouterOutput({
      inputSrj: viaInput,
      outputSrj: throughObstacle,
    }).diagnostics.some((diagnostic) => diagnostic.code === "INVALID_SEGMENT"),
  ).toBe(true)

  const sharedTerminalInput: SimpleRouteJson = {
    ...createInput(),
    connections: [
      {
        name: "left",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top" },
          { x: 0, y: 0, layer: "top" },
        ],
      },
      {
        name: "right",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 1, y: 0, layer: "top" },
        ],
      },
    ],
  }
  const sharedTerminalOutput: SimpleRouteJson = {
    ...sharedTerminalInput,
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "left-trace",
        connection_name: "left",
        connectsTo: [],
        route: [
          { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
          { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
        ],
      },
      {
        type: "pcb_trace",
        pcb_trace_id: "right-trace",
        connection_name: "right",
        connectsTo: [],
        route: [
          { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
          { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
        ],
      },
    ],
  }
  expect(
    validateAutorouterOutput({
      inputSrj: sharedTerminalInput,
      outputSrj: sharedTerminalOutput,
    }),
  ).toEqual({ valid: true, diagnostics: [] })

  const rotatedObstacleInput: SimpleRouteJson = {
    ...createInput(),
    connections: [
      {
        name: "rotated-pad-net",
        pointsToConnect: [
          { x: -4, y: 0, layer: "top", pointId: "outside" },
          { x: 0.7, y: 0.7, layer: "top", pointId: "inside-rotated-pad" },
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 4,
        height: 0.2,
        ccwRotationDegrees: 45,
        layers: ["top"],
        connectedTo: ["rotated-pad-net"],
      },
    ],
  }
  const rotatedObstacleOutput: SimpleRouteJson = {
    ...rotatedObstacleInput,
    traces: [
      wireTrace({
        traceId: "rotated-pad-trace",
        connectionName: "rotated-pad-net",
        connectsTo: ["outside", "inside-rotated-pad"],
        start: { x: -4, y: 0 },
        end: { x: 1, y: 0 },
      }),
    ],
  }
  expect(
    validateAutorouterOutput({
      inputSrj: rotatedObstacleInput,
      outputSrj: rotatedObstacleOutput,
    }).diagnostics.some(
      (diagnostic) => diagnostic.code === "DISCONNECTED_ROUTE_ENDPOINT",
    ),
  ).toBe(true)
})
