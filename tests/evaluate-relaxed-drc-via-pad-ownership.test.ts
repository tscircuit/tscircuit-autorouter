import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import cases from "./fixtures/sample24-reference-via-pad-cases.json"

test("reference DRC reports sample24 foreign and source-less SMT via contacts with their trace owners", (): void => {
  for (const fixture of cases) {
    const { obstacle, via, connectionName } = fixture
    const srj: SimpleRouteJson = {
      layerCount: 8,
      minTraceWidth: 0.1,
      minViaPadDiameter: via.padDiameter,
      minViaHoleDiameter: via.holeDiameter,
      bounds: { minX: 0, minY: 0, maxX: 300, maxY: 200 },
      obstacles: [obstacle],
      connections: [
        {
          name: connectionName,
          pointsToConnect: [
            { x: via.x - 4, y: via.y, layer: "inner1" },
            { x: via.x + 4, y: via.y, layer: "inner2" },
          ],
        },
      ],
    }
    const trace: SimplifiedPcbTrace = {
      type: "pcb_trace",
      pcb_trace_id: `${connectionName}_owner`,
      connection_name: connectionName,
      route: [
        {
          route_type: "wire",
          x: via.x - 4,
          y: via.y,
          layer: "inner1",
          width: 0.1,
        },
        {
          route_type: "via",
          x: via.x,
          y: via.y,
          from_layer: "inner1",
          to_layer: "inner2",
          via_diameter: via.padDiameter,
          via_hole_diameter: via.holeDiameter,
        },
        {
          route_type: "wire",
          x: via.x + 4,
          y: via.y,
          layer: "inner2",
          width: 0.1,
        },
      ],
    }
    const snapshot = structuredClone({ srj, trace })
    const result = evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: srj,
      routedTraces: [trace],
      drcOptions: { includeTraceContinuity: false },
    })
    const errors = result.errors.filter(
      (error) => error.type === "pcb_pad_pad_clearance_error",
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({
      type: "pcb_pad_pad_clearance_error",
      pcb_trace_id: trace.pcb_trace_id,
      pcb_trace_ids: [trace.pcb_trace_id],
      pcb_via_id: "via_0",
      pcb_via_ids: ["via_0"],
      pcb_pad_ids: ["via_0", obstacle.circuitJsonMetadata.pcb_smtpad_id],
      minimum_clearance: 0.1,
    })
    expect(errors[0]!.actual_clearance).toBeLessThan(0.1)
    expect(result.locationAwareErrors).toHaveLength(result.errors.length)
    expect(
      result.circuitJson.find((element) => element.type === "pcb_via")?.layers,
    ).toEqual([
      "top",
      "inner1",
      "inner2",
      "inner3",
      "inner4",
      "inner5",
      "inner6",
      "bottom",
    ])
    expect({ srj, trace }).toEqual(snapshot)
  }
})
