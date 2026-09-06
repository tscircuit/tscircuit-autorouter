import { beforeAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import fullGameboySrj from "../../fixtures/bug-reports/full-gameboy-current-pipeline9/full-gameboy-current-pipeline9.srj.json" with {
  type: "json",
}

const fixtureUrl = new URL(
  "../../fixtures/bug-reports/full-gameboy-current-pipeline9/full-gameboy-current-pipeline9.srj.json",
  import.meta.url,
)

describe.skipIf(process.env.RUN_FULL_GBA_REPRO !== "1")(
  "full Game Boy Advance Pipeline 9 repro",
  () => {
    let relaxedDrcErrors: ReturnType<typeof evaluateRelaxedDrc>["errors"] = []

    beforeAll(async () => {
      const fixtureBytes = readFileSync(fixtureUrl)
      const fixtureSha256 = createHash("sha256")
        .update(new Uint8Array(fixtureBytes))
        .digest("hex")
      expect(fixtureSha256).toBe(
        "493b7759d3751457119bf5e4f15138665c5f2fa2f578bf562c1e92def60392f4",
      )

      const input = structuredClone(fullGameboySrj) as SimpleRouteJson
      expect(input.connections).toHaveLength(145)
      expect(input.obstacles).toHaveLength(411)
      expect(input.traces).toBeUndefined()
      expect(input.layerCount).toBe(4)

      const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
        cacheProvider: null,
        effort: 5,
      })
      solver.solve()

      expect(solver.error).toBeNull()
      expect(solver.failed).toBeFalse()
      expect(solver.solved).toBeTrue()

      const routedTraces = solver.getOutputSimplifiedPcbTraces()
      expect(routedTraces.length).toBeGreaterThan(0)
      const srjWithPointPairs = solver.srjWithPointPairs
      if (!srjWithPointPairs) {
        throw new Error("Pipeline 9 did not produce point-pair SRJ")
      }

      await expect(
        getBugReportSnapshotSvg({
          inputSrj: input,
          srjWithPointPairs,
          routedTraces,
        }),
      ).toMatchSvgSnapshot(import.meta.path)

      const relaxedDrcResult = evaluateRelaxedDrc({
        inputSrj: input,
        srjWithPointPairs,
        routedTraces,
      })
      relaxedDrcErrors = relaxedDrcResult.errors
      console.log(
        "FULL_GBA_RELAXED_DRC_ERRORS",
        JSON.stringify(relaxedDrcResult.errorsWithCenters, null, 2),
      )
    })

    test.failing("the fully routed board should pass relaxed DRC", () => {
      expect(relaxedDrcErrors).toEqual([])
    })
  },
)
