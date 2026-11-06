import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { createDrcConnectivityMap } from "lib/utils/createDrcConnectivityMap"

test("SRJ18 sample006 legacy oval circles preserve native pad geometry beside a through via", (): void => {
  // Read the captured legacy `type: "oval"` geometry at the dataset JSON boundary.
  const fixture: {
    srj: SimpleRouteJson
    traces: SimplifiedPcbTrace[]
    sourcePads: Array<{
      shape: string
      radius: number
      x: number
      y: number
      layer: string
      pcb_port_id: string
    }>
  } = JSON.parse(
    readFileSync(
      new URL("../fixtures/srj18-sample006-circle-via-pad.json", import.meta.url),
      "utf8",
    ),
  )
  const original = structuredClone(fixture)
  const evaluate = (
    srj: SimpleRouteJson,
    routedTraces: SimplifiedPcbTrace[] = fixture.traces,
  ): ReturnType<typeof evaluateRelaxedDrc> =>
    evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: srj,
      routedTraces,
      // The fixture contains the actual via span, with its wires cropped away.
      drcOptions: { includeTraceContinuity: false },
    })
  const actual = evaluate(fixture.srj)
  expect(actual.errors).toEqual([])
  const pads = actual.circuitJson.filter(
    (element) => element.type === "pcb_smtpad",
  )
  expect(pads).toHaveLength(2)
  for (const [index, pad] of pads.entries()) {
    const sourcePad = fixture.sourcePads[index]!
    expect(pad).toMatchObject({
      shape: sourcePad.shape,
      radius: sourcePad.radius,
      layer: sourcePad.layer,
      pcb_port_id: sourcePad.pcb_port_id,
      x: fixture.srj.obstacles[index]!.center.x,
      y: fixture.srj.obstacles[index]!.center.y,
    })
    if (pad.shape !== "circle") throw new Error("Expected a native circular pad")
    expect(pad.x).toBeCloseTo(sourcePad.x, 9)
    expect(pad.y).toBeCloseTo(sourcePad.y, 9)
  }
  const vias = actual.circuitJson.filter((element) => element.type === "pcb_via")
  expect(vias).toEqual([
    expect.objectContaining({
      pcb_trace_id: fixture.traces[0]!.pcb_trace_id,
      x: 14.42900377620101,
      y: -4.249048740086259,
      outer_diameter: 0.3,
      hole_diameter: 0.15,
      layers: ["top", "inner1", "inner2", "inner3", "inner4", "bottom"],
    }),
  ])
  const connectivity = createDrcConnectivityMap(actual.circuitJson)
  for (const pad of pads) {
    expect(
      connectivity.areIdsConnected(vias[0]!.pcb_via_id, pad.pcb_smtpad_id),
    ).toBe(false)
    expect(
      connectivity.areIdsConnected(pad.pcb_smtpad_id, pad.pcb_port_id!),
    ).toBe(true)
  }

  const squares = {
    ...fixture.srj,
    obstacles: fixture.srj.obstacles.map((obstacle) => ({
      ...obstacle,
      type: "rect" as const,
    })),
  }
  const squareResult = evaluate(squares)
  expect(squareResult.errors).toHaveLength(2)
  for (const error of squareResult.errors) {
    expect(error).toMatchObject({
      type: "pcb_pad_pad_clearance_error",
      minimum_clearance: 0.1,
    })
  }
  expect(
    squareResult.circuitJson
      .filter((element) => element.type === "pcb_smtpad")
      .map((pad) => pad.shape),
  ).toEqual(["rect", "rect"])

  for (const variant of [
    { height: 0.46 },
    { ccwRotationDegrees: 45 },
    { ccwRotationDegrees: 0 },
  ]) {
    const input = {
      ...fixture.srj,
      obstacles: fixture.srj.obstacles.map((obstacle) => ({
        ...obstacle,
        ...variant,
      })),
    }
    const convertedPads = evaluate(input).circuitJson.filter(
      (element) => element.type === "pcb_smtpad",
    )
    expect(convertedPads.map((pad) => pad.shape)).toEqual(
      "ccwRotationDegrees" in variant
        ? ["rotated_rect", "rotated_rect"]
        : ["rect", "rect"],
    )
  }

  const nativeCircles = {
    ...fixture.srj,
    obstacles: fixture.srj.obstacles.map((obstacle) => ({
      ...obstacle,
      type: "rect" as const,
      shape: "circle" as const,
    })),
  }
  expect(evaluate(nativeCircles).errors).toEqual([])
  const collision = structuredClone(fixture.traces)
  for (const token of collision[0]!.route) {
    if (token.route_type !== "wire" && token.route_type !== "via") continue
    token.x = fixture.srj.obstacles[0]!.center.x
    token.y = fixture.srj.obstacles[0]!.center.y
  }
  expect(evaluate(nativeCircles, collision).errors).toContainEqual(
    expect.objectContaining({
      type: "pcb_pad_pad_clearance_error",
      minimum_clearance: 0.1,
    }),
  )
  expect(fixture).toEqual(original)
})
