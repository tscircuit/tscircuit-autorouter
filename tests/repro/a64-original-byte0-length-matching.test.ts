import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { expect, test } from "bun:test"
import sourceMetadata from "../../fixtures/repro/a64-original-byte0-length-matching.metadata.json" with {
  type: "json",
}
import { LengthMatchingPostProcessingSolver } from "lib/solvers/length-matching-post-processing-solver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types/srj-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import {
  getOriginalA64LengthMatchingSvg,
  getOriginalA64PathLengths,
} from "../fixtures/originalA64LengthMatching"

type RealA64Fixture = {
  srj: SimpleRouteJson
  hdRoutes: HighDensityRoute[]
  originalCarriers: SimplifiedPcbTrace[]
}

test(
  "original A64 DQ1/DQ3 paths stay matched through retained terminal escapes",
  async (): Promise<void> => {
    const bytes = gunzipSync(
      Uint8Array.from(
        readFileSync(
          new URL(
            "../../fixtures/repro/a64-original-byte0-length-matching.json.gz",
            import.meta.url,
          ),
        ),
      ),
    )
    expect(
      createHash("sha256").update(Uint8Array.from(bytes)).digest("hex"),
    ).toBe(sourceMetadata.payloadSha256)
    const fixture = JSON.parse(bytes.toString("utf8")) as RealA64Fixture
    const original = structuredClone(fixture)
    const { srj } = fixture
    expect(srj.layerCount).toBe(6)
    expect(srj.obstacles).toHaveLength(2122)
    expect(srj.connections).toHaveLength(11)
    expect(srj.traces).toHaveLength(22)
    expect(fixture.hdRoutes).toHaveLength(11)

    const originalCarriers = fixture.hdRoutes.map((route, index) => ({
      ...fixture.originalCarriers[index]!,
      route: convertHdRouteToSimplifiedRoute(route, srj.layerCount),
    }))
    // This includes the source's individual 0.1066/0.127 mm wire widths.
    expect(originalCarriers).toEqual(fixture.originalCarriers)
    expect(srj.buses).toEqual([
      {
        busId: "A64_DQ1_DQ3_original_two_terminal_escapes",
        name: "Original A64 byte0 DQ1/DQ3 data subset",
        connectionNames: ["/S0SDQ1", "/S0SDQ3"],
        maxLengthSkew: 0.635,
      },
    ])
    const originalLengths = getOriginalA64PathLengths({
      srj,
      traces: [...srj.traces!, ...originalCarriers],
    })
    expect(originalLengths.skew).toBeLessThanOrEqual(originalLengths.limit)
    const drcOptions = { traceClearance: 0.10668, viaClearance: 0.1 }
    const originalDrc = evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: srj,
      routedTraces: originalCarriers,
      drcOptions,
      includeBoardClearance: true,
    })
    expect(
      originalDrc.circuitJson.filter(
        (element) =>
          element.type === "pcb_smtpad" ||
          element.type === "pcb_plated_hole" ||
          element.type === "pcb_hole",
      ),
    ).toHaveLength(srj.obstacles.length)
    const solver = new LengthMatchingPostProcessingSolver({
      hdRoutes: fixture.hdRoutes,
      differentialPairs: [],
      buses: srj.buses!,
      connections: srj.connections,
      traces: srj.traces,
      obstacles: srj.obstacles,
      bounds: srj.bounds,
      layerCount: srj.layerCount,
      obstacleMargin: 0.10668,
    })
    let matchingError: Error | undefined
    try {
      solver.solve()
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.name !== "LengthMatchingNoSolutionError" ||
        !error.message.includes('"/S0SDQ3"; required 0.8000mm')
      ) {
        throw error
      }
      matchingError = error
    }
    const outputRoutes = solver.solved ? solver.getOutput().hdRoutes : undefined
    const outputCarriers = outputRoutes?.map((route, index) => ({
      ...fixture.originalCarriers[index]!,
      route: convertHdRouteToSimplifiedRoute(route, srj.layerCount),
    }))
    const outputDrc = outputCarriers
      ? evaluateRelaxedDrc({
          inputSrj: srj,
          srjWithPointPairs: srj,
          routedTraces: outputCarriers,
          drcOptions,
          includeBoardClearance: true,
        })
      : undefined
    if (!outputCarriers && !matchingError) {
      throw new Error("Expected matching output or the specific DQ3 failure")
    }
    await expect(
      getOriginalA64LengthMatchingSvg({
        srj,
        originalCarriers,
        originalCheckerErrors: originalDrc.errors.length,
        result:
          outputCarriers && outputDrc
            ? {
                solved: true,
                carriers: outputCarriers,
                checkerErrors: outputDrc.errors.length,
              }
            : { solved: false, error: matchingError! },
      }),
    ).toMatchSvgSnapshot(import.meta.path)

    expect(originalDrc.errors).toHaveLength(0)
    expect(fixture).toEqual(original)
    // The ordinary baseline run reached this assertion after writing its SVG.
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(matchingError).toBeUndefined()
    expect(outputRoutes).toEqual(original.hdRoutes)
    const outputLengths = getOriginalA64PathLengths({
      srj,
      traces: [...srj.traces!, ...outputCarriers!],
    })
    expect(outputLengths.skew).toBeLessThanOrEqual(outputLengths.limit)
    expect(outputDrc!.errors).toHaveLength(originalDrc.errors.length)
    expect(outputDrc!.errors).toHaveLength(0)
  },
)
