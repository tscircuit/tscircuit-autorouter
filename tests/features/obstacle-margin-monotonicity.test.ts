import { readFileSync } from "node:fs"
import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingPipelineSolver2_PortPointPathing as Pipeline2 } from "lib/autorouter-pipelines/AutoroutingPipeline2_PortPointPathing/AutoroutingPipelineSolver2_PortPointPathing"
import { AutoroutingPipelineSolver4_TinyHypergraph as Pipeline4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"

function measureMinDifferentNetTraceGap(
  traces: SimplifiedPcbTraces,
  connMap: ConnectivityMap,
): number {
  const segs: Array<{
    conn: string
    layer: string
    w: number
    a: { x: number; y: number }
    b: { x: number; y: number }
  }> = []
  for (const t of traces) {
    for (let i = 0; i < t.route.length - 1; i++) {
      const p = t.route[i]
      const q = t.route[i + 1]
      if (p.route_type !== "wire" || q.route_type !== "wire") continue
      if (p.layer !== q.layer) continue
      segs.push({
        conn: t.connection_name,
        layer: p.layer,
        w: p.width ?? 0.15,
        a: { x: p.x, y: p.y },
        b: { x: q.x, y: q.y },
      })
    }
  }
  let minGap = Infinity
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (segs[i].conn === segs[j].conn) continue
      if (connMap.areIdsConnected(segs[i].conn, segs[j].conn)) continue
      if (segs[i].layer !== segs[j].layer) continue
      const dist = minimumDistanceBetweenSegments(
        segs[i].a,
        segs[i].b,
        segs[j].a,
        segs[j].b,
      )
      const gap = dist - (segs[i].w + segs[j].w) / 2
      if (gap < minGap) minGap = gap
    }
  }
  return minGap
}

const rawBugreport = JSON.parse(
  readFileSync(
    "fixtures/bug-reports/bugreport01-be84eb/bugreport01-be84eb.json",
    "utf8",
  ),
)
const baseSrj: SimpleRouteJson = rawBugreport.simple_route_json ?? rawBugreport

test(
  "Pipeline 2 defaultObstacleMargin is effective and scales copper clearance",
  () => {
    const srjSmall = structuredClone(baseSrj)
    srjSmall.defaultObstacleMargin = 0.05
    const solverSmall = new Pipeline2(srjSmall)
    solverSmall.solve()
    expect(solverSmall.solved).toBe(true)
    const gapSmall = measureMinDifferentNetTraceGap(
      solverSmall.getOutputSimplifiedPcbTraces(),
      solverSmall.connMap,
    )

    const srjLarge = structuredClone(baseSrj)
    srjLarge.defaultObstacleMargin = 0.25
    const solverLarge = new Pipeline2(srjLarge)
    solverLarge.solve()
    expect(solverLarge.solved).toBe(true)
    const gapLarge = measureMinDifferentNetTraceGap(
      solverLarge.getOutputSimplifiedPcbTraces(),
      solverLarge.connMap,
    )

    // Previously, Pipeline 2 output a flat 0.1130 mm regardless of configured margin.
    // Now clearance responds to defaultObstacleMargin and scales significantly higher.
    expect(gapSmall).not.toBeCloseTo(0.113, 2)
    expect(gapLarge).toBeGreaterThan(gapSmall)
    expect(gapLarge).toBeGreaterThanOrEqual(0.25)
  },
  { timeout: 60_000 },
)

test(
  "Pipeline 4 defaultObstacleMargin is effective and scales copper clearance",
  () => {
    const srjSmall = structuredClone(baseSrj)
    srjSmall.defaultObstacleMargin = 0.05
    const solverSmall = new Pipeline4(srjSmall)
    solverSmall.solve()
    expect(solverSmall.solved).toBe(true)
    const gapSmall = measureMinDifferentNetTraceGap(
      solverSmall.getOutputSimplifiedPcbTraces(),
      solverSmall.connMap,
    )

    const srjLarge = structuredClone(baseSrj)
    srjLarge.defaultObstacleMargin = 0.2
    const solverLarge = new Pipeline4(srjLarge)
    solverLarge.solve()
    expect(solverLarge.solved).toBe(true)
    const gapLarge = measureMinDifferentNetTraceGap(
      solverLarge.getOutputSimplifiedPcbTraces(),
      solverLarge.connMap,
    )

    // Clearance in Pipeline 4 must track defaultObstacleMargin instead of collapsing to ~0.10 mm.
    expect(gapLarge).toBeGreaterThan(gapSmall)
    expect(gapLarge).toBeGreaterThanOrEqual(0.2)
  },
  { timeout: 60_000 },
)
