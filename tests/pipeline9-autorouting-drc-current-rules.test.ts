import { expect, test } from "bun:test"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type {
  GetDrcErrorsOptions,
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "lib/types"
import {
  issue3130Input,
  issue3130Traces,
} from "./fixtures/issue3130-via-pad-clearance"

test("Pipeline9 native DRC matches current reference rules and optional categories", () => {
  const input: SimpleRouteJson = {
    ...structuredClone(issue3130Input),
    minBoardEdgeClearance: 0.2,
    minTraceToHoleEdgeClearance: 0.2,
    obstacles: [
      ...issue3130Input.obstacles,
      {
        type: "rect",
        isNonPlatedHole: true,
        obstacleId: "test_hole",
        center: { x: 1.5, y: 1.9 },
        width: 0.7,
        height: 0.5,
        layers: ["top", "bottom"],
        connectedTo: [],
      },
      {
        type: "rect",
        center: { x: -0.2, y: 1.72 },
        width: 0.2,
        height: 0.2,
        layers: ["top"],
        connectedTo: ["foreign"],
        circuitJsonMetadata: { pcb_smtpad_id: "typed_clearance_pad" },
      },
    ],
    connections: [
      ...issue3130Input.connections,
      {
        name: "horizontal",
        pointsToConnect: [
          { x: -0.8, y: 1.5, layer: "top" },
          { x: 2.5, y: 1.5, layer: "top" },
        ],
      },
      {
        name: "vertical",
        pointsToConnect: [
          { x: 0.5, y: 1.2, layer: "top" },
          { x: 0.5, y: 1.9, layer: "top" },
        ],
      },
      {
        name: "board",
        pointsToConnect: [
          { x: 2.85, y: -0.5, layer: "top" },
          { x: 2.85, y: 0.8, layer: "top" },
        ],
      },
      { name: "via_a", pointsToConnect: [{ x: 1.8, y: 1.73, layer: "top" }] },
      { name: "via_b", pointsToConnect: [{ x: 2.15, y: 1.73, layer: "top" }] },
    ],
  }
  const traces: SimplifiedPcbTrace[] = [
    ...structuredClone(issue3130Traces),
    ...input.connections.slice(2, 5).map(
      (connection): SimplifiedPcbTrace => ({
        type: "pcb_trace",
        pcb_trace_id: `trace_${connection.name}`,
        connection_name: connection.name,
        route: connection.pointsToConnect.map((point) => ({
          route_type: "wire",
          x: point.x,
          y: point.y,
          width: 0.1,
          layer: "top",
        })),
      }),
    ),
    ...input.connections.slice(5).map(
      (connection): SimplifiedPcbTrace => ({
        type: "pcb_trace",
        pcb_trace_id: `trace_${connection.name}`,
        connection_name: connection.name,
        route: [
          {
            route_type: "via",
            x: connection.pointsToConnect[0]!.x,
            y: 1.73,
            from_layer: "top",
            to_layer: "bottom",
            via_diameter: 0.3,
            via_hole_diameter: 0.2,
          },
        ],
      }),
    ),
  ]
  const cases: Array<{
    includeBoardClearance: boolean
    drcOptions: GetDrcErrorsOptions
  }> = [
    { includeBoardClearance: false, drcOptions: {} },
    {
      includeBoardClearance: true,
      drcOptions: {
        traceClearance: 0.18,
        viaClearance: 0.25,
        holeClearance: 0.25,
        viaToPadClearance: 0.24,
      },
    },
    {
      includeBoardClearance: true,
      drcOptions: {
        traceClearance: 0.18,
        viaClearance: 0.25,
        holeClearance: 0.25,
        viaToPadClearance: 0.24,
        includeTypedTraceClearance: false,
        includeTraceContinuity: false,
      },
    },
    {
      includeBoardClearance: false,
      drcOptions: {
        traceClearance: 0.04,
        viaClearance: 0,
        holeClearance: 0.05,
        viaToPadClearance: 0.05,
        includeTraceContinuity: false,
      },
    },
  ]
  const observedTypes = new Set<string>()
  const observedMessages: string[] = []
  for (const options of cases) {
    const inputBeforeEvaluation = structuredClone(input)
    const reference = evaluateRelaxedDrc({
      inputSrj: input,
      srjWithPointPairs: input,
      routedTraces: traces,
      ...options,
    })
    const evaluate = createPipeline9AutoroutingDrcEvaluator({
      inputSrj: input,
      srjWithPointPairs: input,
      ...options,
    })
    const actual = evaluate(traces)
    expect(input).toEqual(inputBeforeEvaluation)
    expect(reference.errors.length).toBeGreaterThan(0)
    expect(actual.errors as unknown[]).toEqual(reference.errors as unknown[])
    expect(actual.errorsWithCenters as unknown[]).toEqual(
      reference.errorsWithCenters as unknown[],
    )
    expect(actual.locationAwareErrors as unknown[]).toEqual(
      reference.locationAwareErrors as unknown[],
    )
    for (const error of reference.errors) {
      observedTypes.add(error.type)
      observedMessages.push(error.message)
    }
    const withoutContinuity = evaluateRelaxedDrc({
      inputSrj: input,
      srjWithPointPairs: input,
      routedTraces: traces,
      ...options,
      drcOptions: { ...options.drcOptions, includeTraceContinuity: false },
    })
    expect(
      evaluate(traces, { includeTraceContinuity: false }).errors as unknown[],
    ).toEqual(withoutContinuity.errors as unknown[])
  }
  expect([...observedTypes]).toEqual(
    expect.arrayContaining([
      "pcb_trace_error",
      "pcb_pad_trace_clearance_error",
      "pcb_via_trace_clearance_error",
      "pcb_pad_pad_clearance_error",
      "pcb_via_clearance_error",
    ]),
  )
  expect(
    observedMessages.some((message) => message.includes("board edge")),
  ).toBeTrue()
  expect(
    observedMessages.some((message) => message.includes("non-plated hole")),
  ).toBeTrue()

  const evaluateWidths = createPipeline9AutoroutingDrcEvaluator({
    inputSrj: input,
    srjWithPointPairs: input,
    drcOptions: { includeTraceContinuity: false },
  })
  for (const kind of ["wire", "via"] as const) {
    const candidate = structuredClone(traces)
    const horizontal = candidate[2]!
    horizontal.route = [
      {
        route_type: "wire",
        x: -0.8,
        y: 1.5,
        layer: "top",
        width: kind === "wire" ? 0.1 : 0.4,
      },
      kind === "wire"
        ? { route_type: "wire", x: 2.5, y: 1.5, layer: "top", width: 0.4 }
        : {
            route_type: "via",
            x: 2.5,
            y: 1.5,
            from_layer: "top",
            to_layer: "bottom",
          },
    ]
    const reference = evaluateRelaxedDrc({
      inputSrj: input,
      srjWithPointPairs: input,
      routedTraces: candidate,
      drcOptions: { includeTraceContinuity: false },
    })
    const pairTypes = reference.errors
      .filter(
        (error) =>
          ("pcb_trace_error_id" in error &&
            error.pcb_trace_error_id ===
              "overlap_trace_horizontal_typed_clearance_pad") ||
          ("pcb_pad_id" in error &&
            error.pcb_pad_id === "typed_clearance_pad" &&
            error.pcb_trace_id === horizontal.pcb_trace_id),
      )
      .map((error) => error.type)
    expect(pairTypes).toEqual(
      kind === "wire"
        ? ["pcb_trace_error", "pcb_pad_trace_clearance_error"]
        : ["pcb_trace_error"],
    )
    expect<unknown>(evaluateWidths(candidate)).toEqual(reference)
  }

  const original = structuredClone(input)
  original.connections[2]!.pointsToConnect.push({
    x: 0.5,
    y: 1.1,
    layer: "top",
    pcb_port_id: "joined_port",
  })
  original.obstacles.push({
    type: "rect",
    center: { x: 0.5, y: 1.1 },
    width: 0.04,
    height: 0.04,
    layers: ["top"],
    connectedTo: ["joined_port"],
    circuitJsonMetadata: {
      pcb_smtpad_id: "joined_pad",
      pcb_port_id: "joined_port",
    },
  })
  const paired = structuredClone(original)
  paired.connections[2]!.pointsToConnect.pop()
  paired.connections[3]!.pointsToConnect = []
  const evaluateConnectivity = createPipeline9AutoroutingDrcEvaluator({
    inputSrj: original,
    srjWithPointPairs: paired,
  })
  for (const connected of [false, true, false]) {
    const candidate = structuredClone(traces.slice(2, 4))
    const endpoint = candidate[1]!.route[0]!
    if (endpoint.route_type !== "wire")
      throw new Error("Expected a wire endpoint")
    endpoint.y = connected ? 1.1 : 1.2
    const reference = evaluateRelaxedDrc({
      inputSrj: original,
      srjWithPointPairs: paired,
      routedTraces: candidate,
    })
    expect(
      reference.errors.filter(
        (error) =>
          "pcb_trace_error_id" in error &&
          error.pcb_trace_error_id ===
            "overlap_trace_horizontal_trace_vertical",
      ),
    ).toHaveLength(connected ? 0 : 1)
    expect<unknown>(evaluateConnectivity(candidate)).toEqual(reference)
  }
})
