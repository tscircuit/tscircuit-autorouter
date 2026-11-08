import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { renderRvboyRoutingView } from "../../fixtures/bug-reports/rvboy-escape-via-span/renderRvboyRoutingView"

type Params = ConstructorParameters<typeof Pipeline9JointDrcRepairSolver>[0]
type Capture = {
  params: Omit<Params, "connMap" | "mutatedPreloadedTraceIds"> & {
    connMap: Record<string, string[]>
    mutatedPreloadedTraceIds: string[]
  }
  beforeRoutes: HighDensityRoute[]
}

test("SRJ18 repair preserves legal straight anchor attachments under congestion", async (): Promise<void> => {
  // Full captured sample 14 repair input; only the rendered viewport is cropped.
  const capture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/srj18-14-straight-anchor-preference.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  ) as Capture
  const params: Params = {
    ...capture.params,
    connMap: new ConnectivityMap(capture.params.connMap),
    mutatedPreloadedTraceIds: new Set(capture.params.mutatedPreloadedTraceIds),
  }
  const solver = new Pipeline9JointDrcRepairSolver(params)
  expect(solver.stats.initialJointDrcIssueCount).toBe(682)
  solver.solve()
  expect(solver.failed, solver.error ?? "").toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(solver.stats.initialBoundedRegionalRepairPublishedDrcIssueCount).toBe(
    0,
  )
  expect(solver.exactRepairSolver).toBeUndefined()
  const routes = solver.getOutput()
  expect(routes).toHaveLength(params.newHdRoutes.length)
  for (const [index, route] of routes.entries()) {
    const original = params.newHdRoutes[index]!
    expect(route.connectionName).toBe(original.connectionName)
    expect(route.route[0]).toEqual(original.route[0])
    expect(route.route.at(-1)).toEqual(original.route.at(-1))
    expect(route.traceThickness).toBe(original.traceThickness)
  }
  const convert = (
    hdRoutes: HighDensityRoute[],
  ): ReturnType<typeof convertPipeline7HdRoutesToSimplifiedPcbTraces> =>
    convertPipeline7HdRoutesToSimplifiedPcbTraces({
      connections: params.newConnections,
      originalConnections: params.originalSrj.connections,
      hdRoutes,
      layerCount: params.layerCount,
      obstacles: params.obstacles,
      defaultViaHoleDiameter: params.defaultViaHoleDiameter,
      connMap: params.connMap,
    })
  const after = convert(routes)
  expect(
    evaluateRelaxedDrc({
      inputSrj: params.originalSrj,
      srjWithPointPairs: params.srjWithPointPairs,
      routedTraces: after,
    }).errors,
  ).toHaveLength(0)
  const viewbox = { minX: -40.5, maxX: -29, minY: -4.5, maxY: 5.5 }
  for (const [name, traces] of [
    ["before", convert(capture.beforeRoutes)],
    ["after", after],
  ] as const) {
    const graphics = convertSrjToGraphicsObject({
      ...params.originalSrj,
      connections: [],
      traces,
    })
    await expect(
      renderRvboyRoutingView(
        graphics,
        viewbox,
        "SRJ18 sample 14: congested terminal escapes",
        name === "before"
          ? "Before: bending legal anchor attachments changes seed order and leaves crossings"
          : "After: straight attachments retained; complete board has zero DRC errors",
      ),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: name })
  }
})
