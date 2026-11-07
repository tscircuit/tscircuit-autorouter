import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { renderRvboyRoutingView } from "../../fixtures/bug-reports/rvboy-escape-via-span/renderRvboyRoutingView"

test("exact RVboy edge ports leave physical clearance around a retained SoC bypass", async (): Promise<void> => {
  const captured = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-uniform-retained-clearance.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  )
  const input = {
    ...captured,
    connMap: new ConnectivityMap(captured.connMap.netMap),
  }
  const before = new UniformPortDistributionSolver({
    ...input,
    traceClearance: undefined,
  })
  const after = new UniformPortDistributionSolver(input)
  before.solve()
  after.solve()
  expect(before.solved).toBe(true)
  expect(after.solved).toBe(true)
  const nodeId = "cmn_770__sub_2_0"
  const portId = "ce47759_pp1_z0::0"
  const retained = input.preloadedRoutes.find(
    (route: { connectionName: string }) =>
      route.connectionName === "source_trace_366_fixed_6_0",
  )
  expect(retained).toBeDefined()
  const viewbox = { minX: 6.75, maxX: 7.55, minY: 14.45, maxY: 15.15 }
  for (const [name, solver] of [
    ["before", before],
    ["after", after],
  ] as const) {
    const node = solver
      .getOutput()
      .find((node) => node.capacityMeshNodeId === nodeId)!
    const target = node.portPoints.find((port) => port.portPointId === portId)!
    const gap =
      Math.abs(target.y - retained.route[0].y) -
      (retained.traceThickness + input.minTraceWidth) / 2
    if (name === "before") expect(gap).toBeLessThan(0.1)
    else expect(gap).toBeGreaterThanOrEqual(0.1)
    const graphics = convertSrjToGraphicsObject({
      bounds: viewbox,
      layerCount: 4,
      minTraceWidth: input.minTraceWidth,
      obstacles: [],
      connections: [],
      traces: [
        {
          type: "pcb_trace",
          pcb_trace_id: retained.connectionName,
          connection_name: retained.connectionName,
          route: convertHdRouteToSimplifiedRoute(retained, 4),
        },
      ],
    })
    graphics.lines.push({
      points: [
        { x: 7.02, y: viewbox.minY },
        { x: 7.02, y: viewbox.maxY },
      ],
      strokeColor: "#64748b",
      strokeWidth: 0.003,
    })
    graphics.circles.push(
      ...node.portPoints
        .filter((port) => port.z === 0)
        .map((port) => ({
          center: port,
          radius: input.minTraceWidth / 2,
          fill: port.portPointId === portId ? "#0284c7" : "#f59e0b",
        })),
    )
    await expect(
      renderRvboyRoutingView(
        graphics,
        viewbox,
        "RVboy: port beside a retained SoC bypass",
        `${name === "before" ? "Before" : "After"}: ${(gap * 1000).toFixed(1)} µm copper gap; 100 µm required`,
      ),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: name })
  }
})
