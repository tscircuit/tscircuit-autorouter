import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import {
  UniformPortDistributionSolver,
  type UniformPortDistributionSolverInput,
} from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { renderRvboyRoutingView } from "../../fixtures/bug-reports/rvboy-escape-via-span/renderRvboyRoutingView"

test("exact RVboy port distribution retains the planned side of preloaded copper", async (): Promise<void> => {
  const input = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-uniform-preloaded-order.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  ) as UniformPortDistributionSolverInput
  const targetId = "cmn_1986-outer-merge-1354"
  const portId = "ce55697_pp7_z3::3"
  const before = new UniformPortDistributionSolver({
    ...input,
    preloadedRoutes: [],
  })
  const after = new UniformPortDistributionSolver(input)
  before.solve()
  after.solve()
  expect(before.solved).toBe(true)
  expect(after.solved).toBe(true)
  const originalPort = input.nodeWithPortPoints
    .find((n) => n.capacityMeshNodeId === targetId)!
    .portPoints.find((p) => p.portPointId === portId)!
  const beforeNode = before
    .getOutput()
    .find((n) => n.capacityMeshNodeId === targetId)!
  const afterNode = after
    .getOutput()
    .find((n) => n.capacityMeshNodeId === targetId)!
  expect(
    beforeNode.portPoints.find((p) => p.portPointId === portId)!.y,
  ).toBeLessThan(-7.812)
  expect(afterNode.portPoints.find((p) => p.portPointId === portId)!).toEqual(
    originalPort,
  )
  expect(originalPort.y).toBeGreaterThan(-7.812)

  const viewbox = { minX: 26.15, maxX: 28, minY: -10.6, maxY: -5.2 }
  for (const [name, node] of [
    ["before", beforeNode],
    ["after", afterNode],
  ] as const) {
    const graphics = convertSrjToGraphicsObject({
      bounds: viewbox,
      layerCount: 4,
      minTraceWidth: 0.1,
      minViaDiameter: 0.45,
      obstacles: [],
      connections: [],
      traces: input
        .preloadedRoutes!.filter(
          (r) => r.connectionName === "source_trace_429_fixed_18_6",
        )
        .map((r) => ({
          type: "pcb_trace" as const,
          pcb_trace_id: r.connectionName,
          connection_name: r.connectionName,
          route: convertHdRouteToSimplifiedRoute(r, 4),
        })),
    })
    // Display only the affected bottom-layer edge; the solver receives the full input.
    graphics.circles.push(
      ...node.portPoints
        .filter((p) => p.z === 3 && Math.abs(p.x - originalPort.x) < 1e-8)
        .map((p) => ({
          center: p,
          radius: 0.05,
          layer: "z3",
          fill: p.portPointId === portId ? "red" : "#f59e0b",
        })),
    )
    await expect(
      renderRvboyRoutingView(
        graphics,
        viewbox,
        "RVboy: bottom-layer ports at retained copper",
        name === "before"
          ? "Before: red port crosses the retained blue trace"
          : "After: red port keeps the planner's crossing order",
      ),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: name })
  }
})
