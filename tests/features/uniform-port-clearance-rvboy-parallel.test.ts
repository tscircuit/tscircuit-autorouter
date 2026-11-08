import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import { UniformPortClearanceSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortClearanceSolver"
import type {
  PortPointWithOwnerPair,
  SharedEdge,
} from "lib/solvers/UniformPortDistributionSolver/types"
import { renderRvboyRoutingView } from "../../fixtures/bug-reports/rvboy-escape-via-span/renderRvboyRoutingView"

type Capture = {
  edges: Array<[string, SharedEdge]>
  portsByEdge: Array<[string, PortPointWithOwnerPair[]]>
  originalPositionsByPortId: Array<[string, { x: number; y: number }]>
  boundsByPortId: Array<[string, { min: number; max: number }]>
  connMap: Record<string, string[]>
  separation: number
}

test("RVboy parallel boundary motion uses exact Euclidean clearance", async (): Promise<void> => {
  const captured: Capture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-parallel-boundary-ports.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  )
  const original = JSON.stringify(captured)
  const input = {
    ...captured,
    edges: new Map(captured.edges),
    portsByEdge: new Map(captured.portsByEdge),
    originalPositionsByPortId: new Map(captured.originalPositionsByPortId),
    boundsByPortId: new Map(captured.boundsByPortId),
    connMap: new ConnectivityMap(captured.connMap),
  }
  const solver = new UniformPortClearanceSolver(input)
  solver.solve()
  expect(solver.solved, solver.error ?? "").toBeTrue()
  expect(solver.stats.maximumViolation).toBeLessThanOrEqual(1e-8)
  const output = solver.getOutput()
  const byNode = new Map<string, PortPointWithOwnerPair[]>()
  for (const [key, edge] of input.edges) {
    const axis = edge.orientation === "vertical" ? "y" : "x"
    for (const port of output.get(key)!) {
      const before = input.portsByEdge
        .get(key)!
        .find((p) => p.portPointId === port.portPointId)!
      const bounds = input.boundsByPortId.get(port.portPointId!)!
      expect(port[axis]).toBeGreaterThanOrEqual(bounds.min - 1e-8)
      expect(port[axis]).toBeLessThanOrEqual(bounds.max + 1e-8)
      expect(port[axis === "x" ? "y" : "x"]).toBe(
        before[axis === "x" ? "y" : "x"],
      )
      for (const node of edge.ownerNodeIds) {
        const ports = byNode.get(node) ?? []
        if (!ports.some((p) => p.portPointId === port.portPointId))
          ports.push(port)
        byNode.set(node, ports)
      }
    }
  }
  let checkedPairs = 0
  for (const ports of byNode.values())
    for (let i = 0; i < ports.length; i++)
      for (const other of ports.slice(i + 1)) {
        const port = ports[i]!
        if (
          port.z !== other.z ||
          port.connectionName === other.connectionName ||
          input.connMap.areIdsConnected(
            port.connectionName,
            other.connectionName,
          )
        )
          continue
        expect(
          Math.hypot(port.x - other.x, port.y - other.y),
        ).toBeGreaterThanOrEqual(input.separation - 1e-8)
        checkedPairs++
      }
  expect(checkedPairs).toBeGreaterThan(10_000)
  expect(JSON.stringify(captured)).toBe(original)
  const ids = ["ce43408_pp1_z0::0", "ce44012_pp0_z0::0"]
  for (const [name, ports] of [
    ["before", input.portsByEdge],
    ["after", output],
  ] as const) {
    const pair = ids.map(
      (id) => [...ports.values()].flat().find((p) => p.portPointId === id)!,
    )
    const gap =
      Math.hypot(pair[0]!.x - pair[1]!.x, pair[0]!.y - pair[1]!.y) - 0.1
    const graphics: GraphicsObject = {
      lines: [...input.edges.values()].map((edge) => ({
        points: [
          { x: edge.x1, y: edge.y1 },
          { x: edge.x2, y: edge.y2 },
        ],
        strokeWidth: 0.002,
        strokeColor: "#cbd5e1",
      })),
      circles: [],
    }
    for (const [index, port] of pair.entries())
      graphics.circles!.push(
        {
          center: port,
          radius: 0.1,
          fill: index === 0 ? "rgba(3,105,161,0.18)" : "rgba(234,88,12,0.18)",
          stroke: "none",
        },
        {
          center: port,
          radius: 0.05,
          fill: index === 0 ? "#0369a1" : "#ea580c",
          stroke: "none",
        },
      )
    await expect(
      renderRvboyRoutingView(
        graphics,
        { minX: 5.3, maxX: 5.9, minY: 16.0, maxY: 16.65 },
        "RVboy: parallel seam beside LCD pads",
        `${name === "before" ? "Before: clearance solver did not converge" : "After: exact parallel-motion constraints"}; copper gap ${(gap * 1000).toFixed(1)} µm / 100 µm required`,
      ),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: name })
  }
})
