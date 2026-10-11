import { expect, test } from "bun:test"
import { checkViaTraceClearance } from "@tscircuit/checks"
import type { AnyCircuitElement } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createHash } from "node:crypto"

test("via-to-trace bounds preserve ordered clearance errors and overlap suppression", () => {
  let seed = 17232
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  const outputs: unknown[] = []
  for (let testCase = 0; testCase < 36; testCase++) {
    const circuitJson: AnyCircuitElement[] = []
    for (let traceIndex = 0; traceIndex < 12; traceIndex++) {
      const route = Array.from({ length: 4 }, () => ({
        route_type: "wire" as const,
        x: random() * 4 - 2,
        y: random() * 4 - 2,
        width: traceIndex % 3 === 0 ? 0.00001 : 0.1 + random() * 0.7,
        layer: traceIndex % 4 === 0 ? ("bottom" as const) : ("top" as const),
      }))
      circuitJson.push({
        type: "pcb_trace",
        pcb_trace_id: `trace_${traceIndex}`,
        route,
      })
    }
    for (let viaIndex = 0; viaIndex < 10; viaIndex++) {
      circuitJson.push({
        type: "pcb_via",
        pcb_via_id: `via_${viaIndex}`,
        x: random() * 4 - 2,
        y: random() * 4 - 2,
        outer_diameter: 0.1 + random() * 0.8,
        hole_diameter: 0.05,
        layers: viaIndex % 3 === 0 ? ["bottom"] : ["top", "bottom"],
      })
    }
    // Repeated long segments exercise equal-gap ordering and pair suppression.
    circuitJson.push({
      type: "pcb_trace",
      pcb_trace_id: "ordered",
      route: [
        { route_type: "wire", x: -100, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 100, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: -100, y: 0, width: 0.1, layer: "top" },
      ],
    })
    const gap = [0, 0.000001, 0.094999999, 0.095, 0.095000001, 0.1][
      testCase % 6
    ]!
    circuitJson.push({
      type: "pcb_via",
      pcb_via_id: "boundary",
      x: 0,
      y: 0.25 + gap,
      outer_diameter: 0.4,
      hole_diameter: 0.1,
      layers: ["top"],
    })
    const connMap = new ConnectivityMap({})
    connMap.addConnections([
      ["trace_0", "via_0"],
      ["trace_2", "via_1"],
    ])
    outputs.push(
      checkViaTraceClearance(circuitJson, {
        minClearance: [0, 0.1, 0.2][testCase % 3]!,
        connMap,
      }),
    )
  }
  // Golden includes complete messages, gaps, centers and order from checks 0.0.233.
  expect(
    createHash("sha256").update(JSON.stringify(outputs)).digest("hex"),
  ).toBe("9c4433325a9a846b7417ebc094dda83e5b86f5133040b22f7329ab26b8d20c23")
  expect(outputs.flat().length).toBeGreaterThan(0)

  // Unknown geometry cannot prove separation, even ten mm away on the other axis.
  const nanClearanceError: ReturnType<typeof checkViaTraceClearance> = [
    {
      type: "pcb_via_trace_clearance_error",
      pcb_via_trace_clearance_error_id: "via_trace_clearance_nan_via_nan_trace",
      error_type: "pcb_via_trace_clearance_error",
      message:
        "Via pcb_via[#nan_via] and trace trace[nan_trace] are too close (clearance: NaNmm, minimum: 0.1mm)",
      pcb_via_id: "nan_via",
      pcb_trace_id: "nan_trace",
      minimum_clearance: 0.1,
      actual_clearance: NaN,
      center: { x: NaN, y: NaN },
    },
  ]
  const malformedCases: Array<
    [number, number, number, number, number, boolean | "finite-center"]
  > = [
    [-1, 1, NaN, 0, 0.4, true],
    [NaN, 1, 0.1, 0, 0.4, true],
    [Infinity, 1, 0.1, 0, 0.4, true],
    [-1, 1, 0.1, NaN, 0.4, true],
    [-1, 1, 0.1, Infinity, 0.4, false],
    [-1, 1, 0.1, 0, NaN, true],
    [-1, 1, 0.1, 0, Infinity, false],
    [-1, 1, 0.1, Infinity, Infinity, true],
    [-1e155, 1e155, 0.1, 0, 0.4, true],
    [0, 1e-170, 0.1, 0, 0.4, "finite-center"],
    [0, 0, 0.1, 0, 0.4, false],
  ]
  for (const [
    startX,
    endX,
    width,
    viaX,
    outerDiameter,
    resultKind,
  ] of malformedCases) {
    const circuitJson: AnyCircuitElement[] = [
      {
        type: "pcb_trace",
        pcb_trace_id: "nan_trace",
        route: [
          { route_type: "wire", x: startX, y: 10, width, layer: "top" },
          { route_type: "wire", x: endX, y: 10, width: 0.1, layer: "top" },
        ],
      },
      {
        type: "pcb_via",
        pcb_via_id: "nan_via",
        x: viaX,
        y: 0,
        outer_diameter: outerDiameter,
        hole_diameter: 0.1,
        layers: ["top"],
      },
    ]
    const expectedCenter =
      resultKind === "finite-center"
        ? { x: 0, y: 5.074999999999999 }
        : { x: NaN, y: NaN }
    const expectedErrors =
      resultKind === false
        ? []
        : [{ ...nanClearanceError[0], center: expectedCenter }]
    expect(checkViaTraceClearance(circuitJson, { minClearance: 0.1 })).toEqual(
      expectedErrors,
    )
  }
})
