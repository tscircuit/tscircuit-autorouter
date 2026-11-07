import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { renderRvboyRoutingView } from "../../fixtures/bug-reports/rvboy-escape-via-span/renderRvboyRoutingView"

test("RVboy boundary anchors on perpendicular edges retain physical clearance", async (): Promise<void> => {
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-uniform-corner-clearance.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  )
  const input = {
    ...fixture.input,
    connMap: new ConnectivityMap(fixture.input.connMap.netMap),
  }
  const solver = new UniformPortDistributionSolver(input)
  solver.solve()
  expect(solver.solved).toBe(true)
  const crowdedPairs: Array<{
    first: string
    second: string
    distance: number
  }> = []
  for (const node of solver.getOutput()) {
    const ports = [
      ...new Map(
        node.portPoints.map((port) => [port.portPointId, port]),
      ).values(),
    ]
    for (const [index, first] of ports.entries()) {
      for (const second of ports.slice(index + 1)) {
        if (
          first.z !== second.z ||
          first.connectionName === second.connectionName ||
          input.connMap.areIdsConnected(
            first.connectionName,
            second.connectionName,
          )
        )
          continue
        const distance = Math.hypot(first.x - second.x, first.y - second.y)
        if (distance < input.minTraceWidth + input.traceClearance - 1e-8)
          crowdedPairs.push({
            first: first.portPointId!,
            second: second.portPointId!,
            distance,
          })
      }
    }
  }
  expect(crowdedPairs).toEqual([])
  const before: NodeWithPortPoints = fixture.beforeNode
  const after = solver
    .getOutput()
    .find((node) => node.capacityMeshNodeId === before.capacityMeshNodeId)!
  const viewbox = { minX: 6.24, maxX: 6.64, minY: 14.24, maxY: 14.5 }
  for (const [name, node] of [
    ["before", before],
    ["after", after],
  ] as const) {
    const first = node.portPoints.find(
      (port) => port.portPointId === "ce47751_pp0_z0::0",
    )!
    const second = node.portPoints.find(
      (port) => port.portPointId === "ce47460_pp0_z0::0",
    )!
    const gap =
      Math.hypot(first.x - second.x, first.y - second.y) - input.minTraceWidth
    if (name === "before") expect(gap).toBeLessThan(input.traceClearance)
    else {
      expect(gap).toBeGreaterThanOrEqual(input.traceClearance)
      const copies = solver
        .getOutput()
        .flatMap((n) => n.portPoints)
        .filter((port) => port.portPointId === first.portPointId)
      expect(copies.length).toBeGreaterThanOrEqual(2)
      expect(
        copies.every((port) => port.x === first.x && port.y === first.y),
      ).toBe(true)
    }
    const graphics: GraphicsObject = {
      lines: [
        {
          points: [
            { x: 6.325, y: viewbox.maxY },
            { x: 6.325, y: 14.356 },
            { x: viewbox.maxX, y: 14.356 },
          ],
          strokeColor: "#64748b",
          strokeWidth: 0.002,
        },
      ],
      circles: [
        { center: first, radius: input.minTraceWidth / 2, fill: "#0284c7" },
        { center: second, radius: input.minTraceWidth / 2, fill: "#f59e0b" },
      ],
    }
    await expect(
      renderRvboyRoutingView(
        graphics,
        viewbox,
        "RVboy: clearance at a routing-region corner",
        `${name === "before" ? "Before" : "After"}: ${(gap * 1000).toFixed(1)} µm copper gap; 100 µm required`,
      ),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: name })
  }
})
