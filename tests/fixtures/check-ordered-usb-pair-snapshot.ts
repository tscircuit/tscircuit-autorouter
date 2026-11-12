import { expect } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import { getPcbSnapshot } from "./get-pcb-snapshot"
import {
  getOrderedUsbLaneLengths,
  orderedUsbPair,
  orderedUsbPipelines,
} from "./ordered-usb-pair"
import artwork from "./ordered-usb-pair.artwork.json" with { type: "json" }

export async function checkOrderedUsbPairSnapshot(
  { Pipeline, number }: (typeof orderedUsbPipelines)[number],
  testPath: string,
): Promise<void> {
  const solver = new Pipeline(structuredClone(orderedUsbPair), {
    cacheProvider: null,
  })
  solver.solveUntilPhase("lengthMatchingPostProcessingSolver")
  const connections = solver.netToPointPairsSolver!.newConnections
  const beforeRoutes = structuredClone(solver._getOutputHdRoutes())
  const before = getOrderedUsbLaneLengths(beforeRoutes, connections)
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const afterRoutes = solver._getOutputHdRoutes()
  const after = getOrderedUsbLaneLengths(afterRoutes, connections)
  const tolerance = orderedUsbPair.differentialPairs![0]!.lengthTolerance
  expect(before.skew).toBeGreaterThan(tolerance)
  expect(after.skew).toBeLessThanOrEqual(tolerance)
  expect(after.pHops[0]! - before.pHops[0]!).toBeCloseTo(before.skew, 6)
  const meanderHop = after.laneNames[0]![0]!
  for (const route of beforeRoutes) {
    const matched = afterRoutes.find(
      (output) => output.connectionName === route.connectionName,
    )
    if (route.connectionName === meanderHop) expect(matched).not.toEqual(route)
    else expect(matched).toEqual(route)
  }
  const traces = solver.getOutputSimplifiedPcbTraces()
  const errors = getDrcErrors(
    convertToCircuitJson(solver.srjWithPointPairs!, traces),
  ).errors
  expect(errors).toHaveLength(0)
  console.log("Pipeline", number, "lengths before/after (mm):", before, after)
  await expect(
    getPcbSnapshot(
      solver.srjWithPointPairs!,
      traces,
      [
        "tscircuit-autorouter: routes copper and length-matches differential pairs",
        `Pipeline ${number} completed: meander on D+ J1->ESD; TP1 is not counted`,
        `J1->ESD: ${before.pHops[0]!.toFixed(3)} -> ${after.pHops[0]!.toFixed(3)} mm; TP1 stub ${after.tap.toFixed(3)} mm unchanged`,
        `D+ ${after.p.toFixed(3)} mm; D- ${after.n.toFixed(3)} mm; skew ${before.skew.toFixed(3)} -> ${after.skew.toFixed(3)} mm`,
        `D+ ESD->MCU ${after.pHops[1]!.toFixed(3)} mm unchanged; DRC ${errors.length}; tolerance ${tolerance} mm`,
      ],
      artwork as AnyCircuitElement[],
    ),
  ).toMatchSvgSnapshot(testPath)
}
