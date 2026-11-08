import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { renderPlanarShortcutView } from "../fixtures/renderPlanarShortcutView"

test("exact RVboy spacing moves neighboring ports jointly within their retained-copper bounds", async (): Promise<void> => {
  const captured = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-uniform-joint-clearance.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  )
  const original = JSON.stringify(captured.input)
  const solver = new UniformPortDistributionSolver({
    ...captured.input,
    connMap: new ConnectivityMap(captured.input.connMap.netMap),
  })
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.clearanceSolver?.solved).toBeTrue()
  expect(JSON.stringify(captured.input)).toBe(original)
  const output = solver.getOutput()
  const portIds = ["ce39616_pp0_z0_cramped::0", "ce39613_pp0_z0_cramped::0"]
  const viewbox = { minX: -5.77, maxX: -5.42, minY: 6.24, maxY: 6.59 }
  for (const [name, nodes] of [
    ["before", captured.input.nodeWithPortPoints as NodeWithPortPoints[]],
    ["after", output],
  ] as const) {
    const node = nodes.find((node) => node.capacityMeshNodeId === "cmn_868")!
    const ports = portIds.map(
      (id) => node.portPoints.find((port) => port.portPointId === id)!,
    )
    const gap =
      Math.hypot(ports[0]!.x - ports[1]!.x, ports[0]!.y - ports[1]!.y) -
      captured.input.minTraceWidth
    if (name === "before")
      expect(gap).toBeLessThan(captured.input.traceClearance)
    else {
      expect(gap).toBeGreaterThanOrEqual(captured.input.traceClearance)
      expect(ports[0]!.y).toBeLessThan(6.35)
      expect(ports[1]!.x).toBeLessThan(-5.65)
      for (const port of ports) {
        const copies = output
          .flatMap((node) => node.portPoints)
          .filter((copy) => copy.portPointId === port.portPointId)
        expect(copies.length).toBeGreaterThanOrEqual(2)
        expect(
          copies.every((copy) => copy.x === port.x && copy.y === port.y),
        ).toBeTrue()
      }
    }
    const graphics: GraphicsObject = {
      lines: [
        {
          points: [
            { x: -5.675, y: 6.485 },
            { x: -5.515, y: 6.485 },
            { x: -5.515, y: 6.325 },
          ],
          strokeColor: "#64748b",
          strokeWidth: 0.002,
        },
        ...ports.map((port, index) => ({
          points: Array.from({ length: 65 }, (_, step) => {
            const angle = (2 * Math.PI * step) / 64
            const radius =
              (captured.input.minTraceWidth + captured.input.traceClearance) / 2
            return {
              x: port.x + radius * Math.cos(angle),
              y: port.y + radius * Math.sin(angle),
            }
          }),
          strokeColor: index === 0 ? "#dc2626" : "#2563eb",
          strokeWidth: 0.0015,
        })),
      ],
      circles: ports.map((port, index) => ({
        center: port,
        radius: captured.input.minTraceWidth / 2,
        fill: index === 0 ? "#dc2626" : "#2563eb",
      })),
    }
    await expect(
      renderPlanarShortcutView(graphics, viewbox),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: name })
  }
  // Check every neighboring foreign-net boundary anchor, not just the crop.
  const conflicts: string[] = []
  const connMap = new ConnectivityMap(captured.input.connMap.netMap)
  for (const node of output) {
    const ports = node.portPoints.filter((port) => port.portPointId)
    for (let i = 0; i < ports.length; i++) {
      const first = ports[i]!
      for (const second of ports.slice(i + 1)) {
        if (
          first.z !== second.z ||
          first.portPointId === second.portPointId ||
          first.connectionName === second.connectionName ||
          connMap.areIdsConnected(first.connectionName, second.connectionName)
        )
          continue
        if (
          Math.hypot(first.x - second.x, first.y - second.y) <
          captured.input.minTraceWidth + captured.input.traceClearance - 1e-8
        )
          conflicts.push(`${first.portPointId} / ${second.portPointId}`)
      }
    }
  }
  expect(conflicts).toEqual([])
})
