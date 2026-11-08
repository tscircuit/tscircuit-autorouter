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

test("RVboy aligned opposite-edge ports separate along their movable axes", async (): Promise<void> => {
  // Complete input at the failing clearance stage, before any viewport crop.
  const capture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-aligned-boundary-ports.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  ) as Capture
  const original = structuredClone(capture)
  const input = {
    ...capture,
    edges: new Map(capture.edges),
    portsByEdge: new Map(capture.portsByEdge),
    originalPositionsByPortId: new Map(capture.originalPositionsByPortId),
    boundsByPortId: new Map(capture.boundsByPortId),
    connMap: new ConnectivityMap(capture.connMap),
  }
  const solver = new UniformPortClearanceSolver(input)
  solver.solve()
  expect(solver.solved, solver.error ?? "").toBeTrue()
  const output = solver.getOutput()
  const ids = ["ce59660_pp1_z0::0", "ce59946_pp1_z0::0"]
  const pair = (
    ports: Map<string, PortPointWithOwnerPair[]>,
  ): PortPointWithOwnerPair[] =>
    ids.map(
      (id) => [...ports.values()].flat().find((p) => p.portPointId === id)!,
    )
  const gap = (ports: PortPointWithOwnerPair[]): number =>
    Math.hypot(ports[1]!.x - ports[0]!.x, ports[1]!.y - ports[0]!.y) - 0.1
  expect(gap(pair(input.portsByEdge))).toBeCloseTo(0.0679672, 7)
  expect(gap(pair(output))).toBeGreaterThanOrEqual(0.1)
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
    }
  }
  expect(capture).toEqual(original)
  for (const [name, ports] of [
    ["before", input.portsByEdge],
    ["after", output],
  ] as const) {
    const graphics: GraphicsObject = { lines: [], circles: [] }
    for (const edge of input.edges.values())
      graphics.lines!.push({
        points: [
          { x: edge.x1, y: edge.y1 },
          { x: edge.x2, y: edge.y2 },
        ],
        strokeWidth: 0.002,
        strokeColor: "#cbd5e1",
      })
    for (const [i, port] of pair(ports).entries()) {
      const color = i === 0 ? "#0369a1" : "#ea580c"
      graphics.circles!.push(
        {
          center: port,
          radius: 0.1,
          fill: i === 0 ? "rgba(3,105,161,0.18)" : "rgba(234,88,12,0.18)",
          stroke: "none",
        },
        { center: port, radius: 0.05, fill: color, stroke: "none" },
      )
    }
    await expect(
      renderRvboyRoutingView(
        graphics,
        { minX: 48.18, maxX: 48.66, minY: 15.58, maxY: 16.08 },
        "RVboy: RGB_D1 / LED_K; shaded rings show required spacing",
        `${name === "before" ? "Before: false fixed-port conflict" : "After: ports separate within their allowed edges"}; copper gap ${(gap(pair(ports)) * 1000).toFixed(1)} µm / 100 µm required`,
      ),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: name })
  }
})
