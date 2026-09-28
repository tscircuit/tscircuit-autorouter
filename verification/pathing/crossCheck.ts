import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { homedir } from "node:os"
import { PortPointPathingSolver } from "../../lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import { TinyHypergraphPortPointPathingSolver } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type {
  HgPortPointPathingSolverParams,
  RegionHg,
  RegionPortHg,
} from "../../lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"

type OracleRow =
  | {
      kind: "reuse"
      current: number | null
      assigned: number | null
      allowed: boolean
    }
  | {
      kind: "chain"
      length: number
      injectedLength: number
      projectedPorts: number[]
    }

const oracle = spawnSync(
  `${homedir()}/.elan/bin/lake`,
  [
    "+leanprover/lean4:v4.19.0",
    "-d",
    "verification/pathing",
    "env",
    "lean",
    "--run",
    "verification/pathing/CrossCheck.lean",
  ],
  { encoding: "utf8" },
)
assert.equal(oracle.status, 0, oracle.stderr)
const rows: OracleRow[] = oracle.stdout
  .trim()
  .split("\n")
  .map((line: string): OracleRow => JSON.parse(line))
assert.equal(rows.length, 15)
const legacy = new PortPointPathingSolver({
  simpleRouteJson: {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 },
    obstacles: [],
    connections: [],
  },
  inputNodes: [],
  capacityMeshNodes: [],
})
for (const row of rows) {
  if (row.kind === "reuse") {
    legacy.assignedPortPoints.set("p", {
      connectionName: "owner",
      rootConnectionName:
        row.assigned === null ? undefined : String(row.assigned),
    })
    const penalty = legacy.getPortPointReusePenalty(
      "p",
      row.current === null ? undefined : String(row.current),
    )
    assert.equal(penalty === 0, row.allowed)
    continue
  }
  const regions: RegionHg[] = Array.from(
    { length: row.length + 1 },
    (_, index): RegionHg => ({
      regionId: `r${index}`,
      ports: [],
      d: {
        capacityMeshNodeId: `r${index}`,
        center: { x: index, y: 0 },
        width: 1,
        height: 1,
        availableZ: [0],
        layer: "z0",
      },
    }),
  )
  const ports: RegionPortHg[] = Array.from(
    { length: row.length },
    (_, index): RegionPortHg => {
      const region1 = regions[index]!
      const region2 = regions[index + 1]!
      const port: RegionPortHg = {
        portId: String(index),
        region1,
        region2,
        d: {
          portId: String(index),
          x: index + 0.5,
          y: 0,
          z: 0,
          distToCentermostPortOnZ: 0,
          regions: [region1, region2],
        },
      }
      region1.ports.push(port)
      region2.ports.push(port)
      return port
    },
  )
  const solver = new TinyHypergraphPortPointPathingSolver({
    graph: { regions, ports },
    layerCount: 2,
    effort: 0.01,
    flags: { FORCE_CENTER_FIRST: false, RIPPING_ENABLED: false },
    weights: {} as HgPortPointPathingSolverParams["weights"],
    connections: [
      {
        connectionId: "route",
        mutuallyConnectedNetworkId: "net",
        startRegion: regions[0]!,
        endRegion: regions[row.length]!,
        simpleRouteConnection: {
          name: "route",
          pointsToConnect: [
            { x: 0, y: 0, layer: "top" },
            { x: row.length, y: 0, layer: "top" },
          ],
        },
      },
    ],
  })
  solver.solve()
  assert.equal(solver.failed, false)
  assert.equal(solver.solved, true)
  const ids = new Set(
    solver
      .getOutput()
      .nodesWithPortPoints.flatMap((node) =>
        node.portPoints.map((point) => point.portPointId),
      ),
  )
  assert.equal(ids.size, row.injectedLength)
  const projected = [...ids]
    .filter((id) => !id!.startsWith("tiny-terminal:"))
    .map(Number)
    .sort((a, b) => a - b)
  assert.deepEqual(projected, row.projectedPorts)
}
console.log(
  "15 Lean/TypeScript cross-checks passed (9 ownership cases, 6 actual solved chains)",
)
