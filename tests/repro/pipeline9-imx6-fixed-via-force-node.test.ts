import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import { Pipeline9HighDensityForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("i.MX6 force improvement preserves the gap to the fixed DDR via", (): void => {
  const url = new URL(
    "../fixtures/assets/imx6-fixed-via-force-node.json.gz",
    import.meta.url,
  )
  const params = JSON.parse(
    gunzipSync(new Uint8Array(readFileSync(url))).toString("utf8"),
  ) as ConstructorParameters<typeof Pipeline9HighDensityForceImproveSolver>[0]
  const fixedVia = params.inputSrj.obstacles[0]!
  // This is the footprint of checkpoint_via_23 in the captured PCB.
  expect(params.inputSrj.obstacles).toHaveLength(1)
  expect(fixedVia).toMatchObject({
    shape: "circle",
    connectedTo: ["source_net_311"],
  })
  const gapToFixedVia = (routes: HighDensityRoute[]): number => {
    const controlRoute = routes.find(
      (route) => route.connectionName === "source_net_247_mst2",
    )!
    const via = controlRoute.vias[0]!
    return (
      Math.hypot(via.x - fixedVia.center.x, via.y - fixedVia.center.y) -
      (controlRoute.viaDiameter + fixedVia.width) / 2
    )
  }

  const incomingGap = gapToFixedVia(params.hdRoutes)
  expect(incomingGap).toBeCloseTo(0.051212, 6)
  const candidate = new HighDensityForceImproveSolver(params)
  candidate.solve()
  expect(candidate.solved).toBeTrue()
  expect(gapToFixedVia(candidate.getOutput())).toBeCloseTo(0.003983, 6)

  const guarded = new Pipeline9HighDensityForceImproveSolver(params)
  guarded.solve()
  expect(guarded.solved).toBeTrue()
  expect(gapToFixedVia(guarded.getOutput())).toBe(incomingGap)
})
