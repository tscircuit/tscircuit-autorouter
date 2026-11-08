import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import {
  arePipeline9RoutesOnSameNet,
  doPipeline9RoutesHaveCopperConflict,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import {
  UniformPortDistributionSolver,
  type UniformPortDistributionSolverInput,
} from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import { renderRvboyRoutingView } from "../../fixtures/bug-reports/rvboy-escape-via-span/renderRvboyRoutingView"

type RegionalParams = ConstructorParameters<
  typeof Pipeline9RegionalFallbackSolver
>[0]
type Capture = {
  input: Omit<UniformPortDistributionSolverInput, "connMap"> & {
    connMap: { netMap: Record<string, string[]> }
  }
  regional: Omit<
    RegionalParams,
    "connMap" | "nodePfById" | "movablePreloadedConnectionNames"
  > & {
    connMap: Record<string, string[]>
    nodePfById: Record<string, number | null>
    movablePreloadedConnectionNames: string[]
  }
  beforeNode: NodeWithPortPoints
  beforeRoutes: HighDensityRoute[]
}

test("RVboy port spacing reserves a retained through-via on its inner layers", async (): Promise<void> => {
  const capture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-uniform-retained-via.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  ) as Capture
  const original = structuredClone(capture)
  const solver = new UniformPortDistributionSolver({
    ...capture.input,
    connMap: new ConnectivityMap(capture.input.connMap.netMap),
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  const node = solver
    .getOutput()
    .find(
      (n) => n.capacityMeshNodeId === capture.beforeNode.capacityMeshNodeId,
    )!
  const via = { x: -21.825, y: 19.825 }
  const portId = "ce32392_pp2_z2::2"
  const beforePort = capture.beforeNode.portPoints.find(
    (p) => p.portPointId === portId,
  )!
  const afterPort = node.portPoints.find((p) => p.portPointId === portId)!
  const gap = (p: { x: number; y: number }): number =>
    Math.hypot(p.x - via.x, p.y - via.y) - 0.225 - 0.05
  expect(gap(beforePort)).toBeLessThan(0.1)
  expect(gap(afterPort)).toBeGreaterThanOrEqual(0.1)
  const params: RegionalParams = {
    ...capture.regional,
    nodeWithPortPoints: node,
    connMap: new ConnectivityMap(capture.regional.connMap),
    nodePfById: new Map(Object.entries(capture.regional.nodePfById)),
    movablePreloadedConnectionNames: new Set(
      capture.regional.movablePreloadedConnectionNames,
    ),
  }
  const regional = new Pipeline9RegionalFallbackSolver(params)
  regional.solve()
  expect(regional.failed, regional.error ?? "").toBe(false)
  expect(regional.solved).toBe(true)
  const routes = regional.getOutput()
  for (const route of routes)
    for (const fixed of params.fixedRoutes!) {
      if (arePipeline9RoutesOnSameNet(route, fixed, params.connMap)) continue
      expect(
        doPipeline9RoutesHaveCopperConflict({
          left: route,
          right: fixed,
          clearance: 0.1,
          layerCount: 4,
        }),
      ).toBe(false)
    }
  expect(capture).toEqual(original)
  const viewbox = { minX: -22.35, maxX: -19.8, minY: 19.35, maxY: 21.2 }
  for (const [name, candidates, port] of [
    ["before", capture.beforeRoutes, beforePort],
    ["after", routes, afterPort],
  ] as const) {
    const graphics: GraphicsObject = { lines: [], circles: [] }
    graphics.circles!.push(
      { center: via, radius: 0.225, fill: "#fb923c" },
      { center: via, radius: 0.1, fill: "white" },
    )
    for (const route of candidates)
      for (let i = 1; i < route.route.length; i++) {
        const a = route.route[i - 1]!
        const b = route.route[i]!
        if (a.z !== 2 || b.z !== 2) continue
        graphics.lines!.push({
          points: [a, b],
          strokeWidth: route.traceThickness,
          strokeColor:
            route.connectionName === "source_net_118_mst2"
              ? "#0284c7"
              : "#94a3b8",
        })
      }
    graphics.circles!.push({ center: port, radius: 0.05, fill: "#0369a1" })
    await expect(
      renderRvboyRoutingView(
        graphics,
        viewbox,
        "RVboy: A-button signal beside a retained through-via",
        `${name === "before" ? "Before" : "After"}: ${(gap(port) * 1000).toFixed(1)} µm copper gap; 100 µm required`,
      ),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: name })
  }
})
