import { expect } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
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
  let error: Error | undefined
  try {
    solver.solve()
  } catch (thrown) {
    error = thrown as Error
  }
  const connections = solver.netToPointPairsSolver!.newConnections
  const positiveName = orderedUsbPair.differentialPairs![0]!.connectionNames[0]
  const positivePairCount = connections.filter((connection) =>
    connection.__rootConnectionNames?.includes(positiveName),
  ).length
  expect(error).toBeInstanceOf(Error)
  expect(error!.message).toBe(
    `Pipeline${number}: differential pair connection "${positiveName}" must resolve to exactly one final point-pair connection, got ${positivePairCount}`,
  )
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(() => solver.getOutputSimplifiedPcbTraces()).toThrow(
    "Cannot get output before solving is complete",
  )
  const lengths = getOrderedUsbLaneLengths(
    solver._getOutputHdRoutes(),
    connections,
  )
  expect(lengths.skew).toBeGreaterThan(
    orderedUsbPair.differentialPairs![0]!.lengthTolerance,
  )
  console.log(
    "Pipeline",
    number,
    "actual error:",
    error!.message,
    "lengths (mm):",
    lengths,
  )
  // These are the pipeline's real intermediate traces, never final output.
  const traces =
    solver instanceof AutoroutingPipelineSolver7_MultiGraph
      ? solver.getPrePowerTraceOutputSimplifiedPcbTraces()
      : solver.getNewTracesBeforePowerExpansion()
  expect(
    getDrcErrors(convertToCircuitJson(solver.srjWithPointPairs!, traces))
      .errors,
  ).toHaveLength(0)
  const [subject, reason] = error!.message.split(" must ")
  await expect(
    getPcbSnapshot(
      solver.srjWithPointPairs!,
      traces,
      [
        "tscircuit-autorouter: routes copper and length-matches differential pairs",
        `main throws: ${subject}`,
        `must ${reason}; no final output; matching never ran`,
        `Copper at failure: D+ ${lengths.p.toFixed(3)} mm; D- ${lengths.n.toFixed(3)} mm; skew ${lengths.skew.toFixed(3)} mm`,
        `TP1 stub ${lengths.tap.toFixed(3)} mm excluded from lane measurement`,
      ],
      artwork as AnyCircuitElement[],
    ),
  ).toMatchSvgSnapshot(testPath)
}
