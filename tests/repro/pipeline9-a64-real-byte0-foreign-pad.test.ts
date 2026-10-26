import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import { countA64Byte0ConnectedSignals } from "../fixtures/countA64Byte0ConnectedSignals"
import { getA64Byte0DrillPadOverlaps } from "../fixtures/getA64Byte0DrillPadOverlaps"
import { getA64Byte0EscapeSnapshotSvg } from "../fixtures/getA64Byte0EscapeSnapshotSvg"
import { getA64Byte0ReferenceDrcInput } from "../fixtures/getA64Byte0ReferenceDrcInput"

test(
  "Pipeline9 routes the exact real A64 byte-zero input without drilling foreign pads",
  async (): Promise<void> => {
    const fixtureUrl = new URL(
      "../fixtures/assets/a64-byte0-source-rules.srj.json.gz",
      import.meta.url,
    )
    const rawInput = gunzipSync(Uint8Array.from(readFileSync(fixtureUrl)))
    expect(
      createHash("sha256").update(Uint8Array.from(rawInput)).digest("hex"),
    ).toBe(
      "1966c316d2223d5c9f5a162dd00f3fdf61b811ab7ef707cac160a42fe1a4c01e",
    )
    const inputSrj = JSON.parse(rawInput.toString("utf8")) as SimpleRouteJson
    const originalInput = structuredClone(inputSrj)
    expect(inputSrj.layerCount).toBe(6)
    expect(inputSrj.obstacles).toHaveLength(2122)
    expect(inputSrj.connections).toHaveLength(11)
    expect(
      inputSrj.connections.flatMap((connection) => connection.pointsToConnect),
    ).toHaveLength(22)
    expect(inputSrj.minViaPadDiameter).toBe(0.327)
    expect(inputSrj.minViaHoleDiameter).toBe(0.2)
    expect(inputSrj.allowBlindAndBuriedVias).toBeFalse()
    expect(inputSrj.allowViaInPad).toBeFalse()

    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      inputSrj,
      { effort: 1, cacheProvider: null },
    )
    solver.solve()
    const routedTraces = solver.getOutputSimplifiedPcbTraces()
    const drcInput = getA64Byte0ReferenceDrcInput({
      inputSrj: originalInput,
      routedTraces,
    })
    const reference = evaluateRelaxedDrc(drcInput)
    const drillOverlaps = getA64Byte0DrillPadOverlaps({
      inputSrj: originalInput,
      routedTraces,
    })
    const connectedSignals = countA64Byte0ConnectedSignals({
      inputSrj: originalInput,
      routedTraces,
    })
    expect(
      drcInput.inputSrj.obstacles.map(({ circuitJsonMetadata, ...obstacle }) =>
        obstacle,
      ),
    ).toEqual(
      originalInput.obstacles.map(({ circuitJsonMetadata, ...obstacle }) =>
        obstacle,
      ),
    )
    expect(
      drcInput.inputSrj.connections.map((connection) =>
        connection.pointsToConnect.map(({ pcb_port_id, ...point }) => point),
      ),
    ).toEqual(
      originalInput.connections.map((connection) =>
        connection.pointsToConnect.map(({ pcb_port_id, ...point }) => point),
      ),
    )

    // Both images are created before the intended correctness assertion.
    // The focused image filters drawing primitives only, never solver input.
    await expect(getBugReportSnapshotSvg(drcInput)).toMatchSvgSnapshot(
      import.meta.path,
      { svgName: "full-board", tolerance: 0 },
    )
    await expect(
      getA64Byte0EscapeSnapshotSvg({
        inputSrj: originalInput,
        routedTraces,
        drcCount: reference.errors.length,
        drillOverlapCount: drillOverlaps.length,
      }),
    ).toMatchSvgSnapshot(import.meta.path, {
      svgName: "ram-escape",
      tolerance: 0,
    })

    expect(solver.failed, solver.error ?? "").toBeFalse()
    expect(solver.solved).toBeTrue()
    expect(inputSrj).toEqual(originalInput)
    expect(connectedSignals).toBe(11)
    expect(drillOverlaps).toHaveLength(0)
    expect(reference.errors).toHaveLength(0)
  },
)
