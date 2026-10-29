import { expect, test } from "bun:test"
import { addAutoroutingViaTraceIds } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { makeOriginalViaPlacementMetadataFixture } from "./fixtures/pipeline9OriginalViaPlacementMetadata"

test("actual board and pad findings acquire exact typed via ownership without changing raw fields", (): void => {
  for (const kind of ["board", "foreign-pad"] as const) {
    const fixture = makeOriginalViaPlacementMetadataFixture(kind)
    expect(fixture.errors).toHaveLength(1)
    const original = structuredClone({ circuitJson: fixture.circuitJson, errors: fixture.errors })
    const output = addAutoroutingViaTraceIds({ errors: fixture.errors, circuitJson: fixture.circuitJson,
      evaluatedTraceIds: new Set([fixture.traceId]), checkOriginalViaPlacement: true })
    expect(output).toHaveLength(fixture.errors.length)
    expect(output[0]!.pcb_via_id).toBe(fixture.viaId)
    expect(output[0]!.pcb_via_ids).toEqual([fixture.viaId])
    expect(output[0]!.pcb_trace_ids).toEqual([fixture.traceId])
    expect(output[0]!.viaPlacementGeometry).toMatchObject({
      kind: kind === "board" ? "board" : "pad", pcbTraceId: fixture.traceId,
      x: 0, y: kind === "board" ? 0.07 : 0, outerDiameter: 0.3,
      ...(kind === "foreign-pad" ? { pad: { type: "pcb_smtpad", id: fixture.padId } } : {}),
    })
    expect(output[0]!.center).toEqual(fixture.errors[0]!.center ?? { x: 0, y: 0.07 })
    for (const [key, value] of Object.entries(fixture.errors[0]!)) expect(output[0]![key]).toEqual(value)
    expect(fixture.circuitJson).toEqual(original.circuitJson)
    expect(fixture.errors).toEqual(original.errors)
  }
})
