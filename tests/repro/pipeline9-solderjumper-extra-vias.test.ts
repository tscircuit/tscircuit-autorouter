import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { checkViaPadClearance } from "@tscircuit/checks"
import { beforeAll, expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import { addSolderjumperViaCountToSvg } from "../fixtures/addSolderjumperViaCountToSvg"

let viaCount: number

beforeAll(async (): Promise<void> => {
  // Unchanged SRJ captured from Core's normal solderjumper-circuit.test.tsx:
  // three 0402 resistors, one solderjumper3_bridged12, four signal traces.
  // The tenth obstacle is the existing fixed solder bridge, not a new route.
  const rawInput = readFileSync(
    new URL("../fixtures/assets/solderjumper-core.srj.json", import.meta.url),
  )
  expect(
    createHash("sha256").update(Uint8Array.from(rawInput)).digest("hex"),
  ).toBe("32a5afccabd7cf3abd0fc4f56a598823c46884713e3ffdbed795dda6083a354e")
  const inputSrj = JSON.parse(rawInput.toString("utf8")) as SimpleRouteJson
  const originalInput = structuredClone(inputSrj)
  expect(inputSrj.connections).toHaveLength(4)
  expect(
    inputSrj.connections.flatMap((connection) => connection.pointsToConnect),
  ).toHaveLength(8)
  expect(inputSrj.obstacles).toHaveLength(10)
  expect(inputSrj.layerCount).toBe(2)
  expect(inputSrj.allowViaInPad).toBeFalse()
  expect(inputSrj.allowBlindAndBuriedVias).toBeFalse()

  // Match Core's default effort and disable caching, without changing the input.
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.failed, solver.error ?? "").toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(inputSrj).toEqual(originalInput)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  expect(routedTraces).toHaveLength(4)
  const drcInput = {
    inputSrj: originalInput,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
    includeBoardClearance: true,
  }
  const reference = evaluateRelaxedDrc(drcInput)
  expect(reference.errors).toHaveLength(0)
  expect(
    checkViaPadClearance(reference.circuitJson, { minClearance: 0.1 }),
  ).toHaveLength(0)
  viaCount = routedTraces.reduce(
    (total, trace) =>
      total + trace.route.filter((point) => point.route_type === "via").length,
    0,
  )
  // Keep snapshots outside the expected failure so rendering failures stay red.
  await expect(
    addSolderjumperViaCountToSvg(getBugReportSnapshotSvg(drcInput), viaCount),
  ).toMatchSvgSnapshot(import.meta.path, { tolerance: 0 })
})

test.failing(
  "Pipeline9 keeps Core's original two-via solderjumper routing limit",
  (): void => {
    expect(viaCount).toBeLessThanOrEqual(2)
  },
)
