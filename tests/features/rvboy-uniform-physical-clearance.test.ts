import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { Obstacle } from "lib/types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

test("all RVboy boundary anchors clear foreign pads after physical graph planning", (): void => {
  // Complete phase-7 input captured from the normal Pipeline 9 spacing stage.
  const captured = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-uniform-physical-clearance.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  )
  const original = JSON.stringify(captured)
  const connMap = new ConnectivityMap(captured.connMap.netMap)
  const solver = new UniformPortDistributionSolver({ ...captured, connMap })
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(JSON.stringify(captured)).toBe(original)
  const obstacles = (captured.obstacles as Obstacle[]).map((obstacle) => ({
    ...obstacle,
    nets: new Set(
      obstacle.connectedTo.map((id) => connMap.getNetConnectedToId(id)),
    ),
    zs:
      obstacle.__zLayers ??
      obstacle.zLayers ??
      obstacle.layers.map((layer) =>
        mapLayerNameToZ(layer, captured.layerCount),
      ),
  }))
  const seen = new Set<string>()
  const conflicts: string[] = []
  for (const node of solver.getOutput()) {
    for (const port of node.portPoints) {
      if (!port.portPointId || seen.has(port.portPointId)) continue
      seen.add(port.portPointId)
      const net =
        connMap.getNetConnectedToId(port.connectionName) ??
        (port.rootConnectionName &&
          (connMap.netMap[port.rootConnectionName]
            ? port.rootConnectionName
            : connMap.getNetConnectedToId(port.rootConnectionName)))
      for (const obstacle of obstacles) {
        if (!obstacle.zs.includes(port.z) || obstacle.nets.has(net)) continue
        const angle = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
        const x = port.x - obstacle.center.x,
          y = port.y - obstacle.center.y
        const distance = Math.hypot(
          Math.max(
            0,
            Math.abs(x * Math.cos(angle) + y * Math.sin(angle)) -
              obstacle.width / 2,
          ),
          Math.max(
            0,
            Math.abs(-x * Math.sin(angle) + y * Math.cos(angle)) -
              obstacle.height / 2,
          ),
        )
        if (
          distance + 1e-7 <
          captured.minTraceWidth / 2 + captured.traceClearance
        )
          conflicts.push(
            `${port.portPointId} / ${obstacle.connectedTo[0]}: ${distance}`,
          )
      }
    }
  }
  expect(seen.size).toBeGreaterThan(6000)
  expect(conflicts).toEqual([])
})
