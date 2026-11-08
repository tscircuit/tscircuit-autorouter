import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { createPipeline9KeepoutDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9KeepoutDrcEvaluator"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { renderRvboyRoutingView } from "../../fixtures/bug-reports/rvboy-escape-via-span/renderRvboyRoutingView"

test("RVboy checks copper clearance against keepouts without pad identities", async (): Promise<void> => {
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-keepout-clearance.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  ) as {
    srj: SimpleRouteJson
    before: SimplifiedPcbTrace
    after: SimplifiedPcbTrace
  }
  const evaluate = createPipeline9KeepoutDrcEvaluator(fixture.srj, 0.1, 0.1)
  expect(evaluate([fixture.before])).toHaveLength(1)
  expect(evaluate([fixture.after])).toHaveLength(0)
  for (const state of ["before", "after"] as const) {
    const trace = fixture[state]
    const errors = evaluate([trace])
    const graphics = convertSrjToGraphicsObject({
      ...fixture.srj,
      obstacles: fixture.srj.obstacles.filter((o) => !o.isCopperPour),
      connections: [],
      traces: [trace],
    })
    await expect(
      renderRvboyRoutingView(
        graphics,
        { minX: -24, maxX: -20.5, minY: 10.8, maxY: 13.2 },
        "RVboy: non-electrical keepout clearance",
        `${state}: ${errors.length} clearance violations; required gap 0.1 mm`,
      ),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: state })
  }
})
