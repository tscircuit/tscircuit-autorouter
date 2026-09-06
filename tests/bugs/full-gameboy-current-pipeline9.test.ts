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
        "e923e714d60e37fe3b2215062c4cd4985b3beae75897b6fce03b4c86cfae68f7",
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

      const relaxedDrcResult = evaluateRelaxedDrc({
        inputSrj: input,
        srjWithPointPairs,
        routedTraces,
      })
      relaxedDrcErrors = relaxedDrcResult.errors
      const errorCenters = relaxedDrcResult.errorsWithCenters.flatMap(
        (error) => (error.center ? [error.center] : []),
      )
      const nearbyRoutedTraces = routedTraces.filter((trace) =>
        trace.route.some((point) => {
          if (!("x" in point) || !("y" in point)) return false
          return errorCenters.some(
            (center) => Math.hypot(point.x - center.x, point.y - center.y) < 2,
          )
        }),
      )
      const implicatedVias = relaxedDrcResult.circuitJson.filter(
        (element) =>
          element.type === "pcb_via" &&
          relaxedDrcResult.errors.some(
            (error) =>
              "pcb_via_id" in error && error.pcb_via_id === element.pcb_via_id,
          ),
      )
      console.log(
        "FULL_GBA_RELAXED_DRC_ERRORS",
        JSON.stringify(relaxedDrcResult.errorsWithCenters, null, 2),
      )
      console.log(
        "FULL_GBA_DRC_REPAIR_STATS",
        JSON.stringify(
          {
            global: solver.globalDrcForceImproveSolver?.stats,
            joint: solver.pipeline9JointDrcRepairSolver?.stats,
          },
          null,
          2,
        ),
      )
      console.log(
        "FULL_GBA_DRC_NEARBY_GEOMETRY",
        JSON.stringify({ implicatedVias, nearbyRoutedTraces }, null, 2),
      )

      await expect(
        getBugReportSnapshotSvg({
          inputSrj: input,
          srjWithPointPairs,
          routedTraces,
        }),
      ).toMatchSvgSnapshot(import.meta.path)
    })

    test("the fully routed board should pass relaxed DRC", () => {
      expect(relaxedDrcErrors).toEqual([])
    })
  },
)
