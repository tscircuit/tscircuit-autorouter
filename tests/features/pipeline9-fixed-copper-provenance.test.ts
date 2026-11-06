import { expect, test } from "bun:test"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import type {
  CircuitJsonMetadata,
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "lib/types"

test("Pipeline9 retains fixed copper until it is represented by a Circuit JSON pad", (): void => {
  const provenanceCases: Array<{
    circuitJsonMetadata?: CircuitJsonMetadata
    isPadRepresented: boolean
  }> = [
    { isPadRepresented: false },
    { circuitJsonMetadata: {}, isPadRepresented: false },
    {
      circuitJsonMetadata: { source_component_name: "U1" },
      isPadRepresented: false,
    },
    {
      circuitJsonMetadata: { pcb_smtpad_id: "pad_DATA4" },
      isPadRepresented: true,
    },
  ]
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "trace_LDQSN",
    connection_name: "LDQSN",
    route: [
      {
        route_type: "via",
        x: 0,
        y: 0,
        from_layer: "inner1",
        to_layer: "top",
        via_diameter: 0.45,
      },
    ],
  }
  for (const { circuitJsonMetadata, isPadRepresented } of provenanceCases) {
    const srj: SimpleRouteJson = {
      layerCount: 4,
      minTraceWidth: 0.11,
      minViaPadDiameter: 0.45,
      minViaEdgeToPadEdgeClearance: 0.11,
      bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
      connections: [],
      obstacles: [
        {
          type: "rect",
          center: { x: 0.2, y: 0 },
          width: 0.127,
          height: 2,
          layers: ["bottom"],
          connectedTo: ["DATA4"],
          circuitJsonMetadata,
        },
      ],
    }
    const evaluate = createPipeline9AutoroutingDrcEvaluator({
      inputSrj: srj,
      srjWithPointPairs: srj,
      drcOptions: { includeTraceContinuity: false },
    })
    const result = evaluate([trace])

    expect(result.errors).toHaveLength(1)
    expect(
      result.errors.filter((error) => error.drc_source === "fixed_copper"),
    ).toHaveLength(isPadRepresented ? 0 : 1)

    const secondTrace = { ...trace, pcb_trace_id: "trace_LDQSP" }
    const movedTrace: SimplifiedPcbTrace = {
      ...trace,
      route: trace.route.map((point) => ({ ...point, x: 1.5 })),
    }
    expect(
      evaluate
        .evaluateFixedCopper([trace, secondTrace])
        .map((error) => [error.pcb_trace_id, error.pcb_via_id]),
    ).toEqual(
      isPadRepresented
        ? []
        : [
            ["trace_LDQSN", "via_0"],
            ["trace_LDQSP", "via_0"],
          ],
    )
    // The unchanged second via becomes via_1 after the first one moves.
    expect(
      evaluate
        .evaluateFixedCopper([movedTrace, secondTrace])
        .map((error) => [error.pcb_trace_id, error.pcb_via_id]),
    ).toEqual(isPadRepresented ? [] : [["trace_LDQSP", "via_1"]])
    expect(
      evaluate.evaluateFixedCopper([
        movedTrace,
        { ...secondTrace, connection_name: "DATA4" },
      ]),
    ).toEqual([])
    expect(
      evaluate.evaluateFixedCopper([
        movedTrace,
        {
          ...secondTrace,
          route: secondTrace.route.map((point) =>
            point.route_type === "via"
              ? { ...point, via_diameter: 0.01 }
              : point,
          ),
        },
      ]),
    ).toEqual([])
  }
})
