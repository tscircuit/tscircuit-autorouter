import { expect, test } from "bun:test"
import { evaluatePairOutput } from "../scripts/differential-pair-benchmark/evaluatePairOutput"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "../lib/types"

test("quality reports matched copper, missing output and unsupported discontinuities independently of solver flags", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    obstacles: [],
    bounds: { minX: -2, maxX: 12, minY: -2, maxY: 2 },
    connections: [0, 0.3].map((y, index) => ({
      name: `pair${index}`,
      pointsToConnect: [
        { x: 0, y, layer: "top" },
        { x: 10, y, layer: "top" },
      ],
    })),
    differentialPairs: [
      {
        connectionNames: ["pair0", "pair1"],
        lengthTolerance: 0.01,
        traceGap: 0.2,
        maxUncoupledLength: 0.05,
      },
    ],
  }
  const traces: SimplifiedPcbTrace[] = srj.connections.map((connection) => ({
    type: "pcb_trace",
    pcb_trace_id: connection.name,
    connection_name: connection.name,
    route: connection.pointsToConnect.map((p) => ({
      route_type: "wire",
      x: p.x,
      y: p.y,
      layer: "top",
      width: 0.1,
    })),
  }))
  const measured = evaluatePairOutput({
    inputSrj: srj,
    outputSrj: { ...srj, traces },
    solved: false,
    failed: true,
    error: "postprocessing rejected pair",
  })
  expect(measured.outputAvailable).toBe(true)
  expect(measured.failed).toBe(true)
  expect(measured.pairs[0]!.measurementStatus).toBe("measured")
  expect(measured.pairs[0]!.skewMm).toBe(0)
  expect(measured.pairs[0]!.maxUncoupled).toBe("pass")
  expect(measured.pairs[0]!.coupling![0]!.coupledFraction).toBeCloseTo(1)
  const missing = evaluatePairOutput({
    inputSrj: srj,
    outputSrj: null,
    solved: false,
    failed: true,
  })
  expect(missing.pairs[0]!.measurementStatus).toBe("unavailable")
  expect(missing.pairs[0]!.fullCompliance).toBe("unknown")
  const malformed = structuredClone(traces)
  const point = malformed[0]!.route[1]!
  if (point.route_type !== "wire") throw new Error("Test fixture expected wire")
  point.layer = "bottom"
  const discontinuous = evaluatePairOutput({
    inputSrj: srj,
    outputSrj: { ...srj, traces: malformed },
    solved: true,
    failed: false,
  })
  expect(discontinuous.pairs[0]!.measurementStatus).toBe("ambiguous")
  expect(discontinuous.pairs[0]!.skewMm).toBeNull()
})
