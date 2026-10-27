import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { beforeAll, expect, test } from "bun:test"
import { checkViaPadClearance } from "@tscircuit/checks"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import { countA64Byte0ConnectedSignals } from "../fixtures/countA64Byte0ConnectedSignals"
import { getA64Byte0DrillPadOverlaps } from "../fixtures/getA64Byte0DrillPadOverlaps"
import { getA64Byte0ReferenceDrcInput } from "../fixtures/getA64Byte0ReferenceDrcInput"
import { getA64ViaPadClearanceSnapshotSvg } from "../fixtures/getA64ViaPadClearanceSnapshotSvg"

const raw = gunzipSync(Uint8Array.from(readFileSync(new URL(
  "../fixtures/assets/a64-byte0-source-rules.srj.json.gz",
  import.meta.url,
))))
const input = JSON.parse(raw.toString("utf8")) as SimpleRouteJson
const original = structuredClone(input)
const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
  effort: 1,
  cacheProvider: null,
})
let measured: ReturnType<typeof checkViaPadClearance>
let reference: ReturnType<typeof evaluateRelaxedDrc>

beforeAll(async (): Promise<void> => {
  solver.solve()
  const traces = solver.getOutputSimplifiedPcbTraces()
  reference = evaluateRelaxedDrc(
    getA64Byte0ReferenceDrcInput({ inputSrj: original, routedTraces: traces }),
  )
  measured = checkViaPadClearance(reference.circuitJson, {
    minClearance: original.defaultObstacleMargin,
  })
  await expect(getA64ViaPadClearanceSnapshotSvg({
    inputSrj: original,
    routedTraces: traces,
    viaPadErrorCount: measured.length,
  })).toMatchSvgSnapshot(import.meta.path, { tolerance: 0 })
})

test.failing("fresh real A64 byte-zero routing preserves via copper clearance to every foreign pad", (): void => {
  expect(createHash("sha256").update(Uint8Array.from(raw)).digest("hex")).toBe(
    "1966c316d2223d5c9f5a162dd00f3fdf61b811ab7ef707cac160a42fe1a4c01e",
  )
  expect(input.obstacles).toHaveLength(2122)
  expect(input.connections).toHaveLength(11)
  expect(input.connections.flatMap((connection) => connection.pointsToConnect)).toHaveLength(22)
  expect(input.layerCount).toBe(6)
  expect(input.traces).toHaveLength(0)
  expect(input.defaultObstacleMargin).toBe(0.10668)
  expect(solver.failed, solver.error ?? "").toBeFalse()
  expect(solver.solved).toBeTrue()
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  expect(countA64Byte0ConnectedSignals({ inputSrj: original, routedTraces })).toBe(11)
  expect(getA64Byte0DrillPadOverlaps({ inputSrj: original, routedTraces })).toHaveLength(0)
  expect(measured).toHaveLength(0)
  expect(reference.errors).toHaveLength(0)
  expect(input).toEqual(original)
})
