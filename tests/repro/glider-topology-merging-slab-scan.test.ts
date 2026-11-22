import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { getSvgFromGraphicsObject } from "graphics-debug"
import {
  TopologyMergingSolver,
  type TopologyMergingSolverParams,
} from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"

type PreparedNodes = { bounds: object }[]

const countBoundsReads = (solver: TopologyMergingSolver): (() => number) => {
  let reads = 0
  const { preparedNodes } = solver as unknown as {
    preparedNodes: PreparedNodes
  }
  for (const prepared of preparedNodes) {
    const { bounds } = prepared
    Object.defineProperty(prepared, "bounds", {
      get: () => {
        reads++
        return bounds
      },
    })
  }
  return () => reads
}

test("Glider topology merging scans every node for each X slab and Y interval", (): void => {
  const fixtureUrl = new URL(
    "../fixtures/assets/glider-topology-merging-input.json.gz",
    import.meta.url,
  )
  const input = JSON.parse(
    gunzipSync(new Uint8Array(readFileSync(fixtureUrl))).toString("utf8"),
  ) as TopologyMergingSolverParams
  const solver = new TopologyMergingSolver(input)
  const getReads = countBoundsReads(solver)
  solver.solve()
  expect(solver.solved).toBe(true)
  const targetNodes = solver.getOutput().filter((node) => node._containsTarget)
  const minX = Math.min(...targetNodes.map((n) => n.center.x - n.width / 2))
  const maxX = Math.max(...targetNodes.map((n) => n.center.x + n.width / 2))
  const minY = Math.min(...targetNodes.map((n) => n.center.y - n.height / 2))
  const maxY = Math.max(...targetNodes.map((n) => n.center.y + n.height / 2))
  const graphics = {
    points: targetNodes.map((node) => ({ ...node.center, color: "blue" })),
    texts: [
      {
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2,
        text: `bounds reads: ${getReads()}`,
        fontSize: (maxX - minX) / 30,
        anchorSide: "center" as const,
      },
    ],
  }
  expect(
    getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path)
})
