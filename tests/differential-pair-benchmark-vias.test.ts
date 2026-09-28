import { expect, test } from "bun:test"
import { evaluatePairOutput } from "../scripts/differential-pair-benchmark/evaluatePairOutput"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "../lib/types"

test("paired layer transitions remain measurable and unsupported route types stay unknown", () => {
  const traces: SimplifiedPcbTrace[] = [0, 0.3].map((y, index) => ({
    type: "pcb_trace",
    pcb_trace_id: `p${index}`,
    connection_name: `p${index}`,
    route: [
      { route_type: "wire", x: 0, y, layer: "top", width: 0.1 },
      { route_type: "wire", x: 5, y, layer: "top", width: 0.1 },
      {
        route_type: "via",
        x: 5,
        y,
        from_layer: "top",
        to_layer: "bottom",
        via_diameter: 0.2,
      },
      { route_type: "wire", x: 5, y, layer: "bottom", width: 0.1 },
      { route_type: "wire", x: 10, y, layer: "bottom", width: 0.1 },
    ],
  }))
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    obstacles: [],
    bounds: { minX: -2, maxX: 12, minY: -2, maxY: 2 },
    connections: [0, 0.3].map((y, index) => ({
      name: `p${index}`,
      pointsToConnect: [
        { x: 0, y, layer: "top" },
        { x: 10, y, layer: "bottom" },
      ],
    })),
    differentialPairs: [
      {
        connectionNames: ["p0", "p1"],
        lengthTolerance: 0.01,
        traceGap: 0.2,
        maxUncoupledLength: 0.05,
      },
    ],
  }
  const measured = evaluatePairOutput({
    inputSrj: srj,
    outputSrj: { ...srj, traces },
    solved: true,
    failed: false,
  })
  expect(measured.pairs[0]!.lengthsMm).toEqual([10, 10])
  expect(measured.pairs[0]!.viaCounts).toEqual([1, 1])
  expect(measured.pairs[0]!.terminalCoverage).toBe("pass")
  expect(measured.pairs[0]!.viaLayerSequences).toEqual([
    ["top->bottom"],
    ["top->bottom"],
  ])
  const terminalVias: SimplifiedPcbTrace[] = [0, 0.3].map((y, index) => ({
    type: "pcb_trace",
    pcb_trace_id: `p${index}`,
    connection_name: `p${index}`,
    route: [
      {
        route_type: "via",
        x: 0,
        y,
        from_layer: "top",
        to_layer: "bottom",
        via_diameter: 0.2,
      },
      { route_type: "wire", x: 0, y, layer: "bottom", width: 0.1 },
      { route_type: "wire", x: 10, y, layer: "bottom", width: 0.1 },
    ],
  }))
  expect(
    evaluatePairOutput({
      inputSrj: srj,
      outputSrj: { ...srj, traces: terminalVias },
      solved: true,
      failed: false,
    }).pairs[0]!.terminalCoverage,
  ).toBe("pass")
  const unsupported = structuredClone(traces)
  unsupported[0]!.route.push({
    route_type: "jumper",
    start: { x: 10, y: 0 },
    end: { x: 11, y: 0 },
    footprint: "0603",
    layer: "bottom",
  })
  expect(
    evaluatePairOutput({
      inputSrj: srj,
      outputSrj: { ...srj, traces: unsupported },
      solved: true,
      failed: false,
    }).pairs[0]!.measurementStatus,
  ).toBe("ambiguous")
})
