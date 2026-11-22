import { expect, spyOn, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { getSvgFromGraphicsObject } from "graphics-debug"
import type { ExpandUnconnectedEdgesToMeshInput } from "lib/solvers/BgaTopologyGeneratorSolver/BgaGapFillTypes"
import { ExpandUnconnectedEdgesToMesh } from "lib/solvers/BgaTopologyGeneratorSolver/ExpandUnconnectedEdgesToMesh"

test("H616 BGA gap fill scans every mesh node for each expanded node", (): void => {
  const fixtureUrl = new URL(
    "../fixtures/assets/h616-bga-gap-fill-inputs.json.gz",
    import.meta.url,
  )
  const inputs = JSON.parse(
    gunzipSync(new Uint8Array(readFileSync(fixtureUrl))).toString("utf8"),
  ) as ExpandUnconnectedEdgesToMeshInput[]
  const overlapScan = spyOn(
    ExpandUnconnectedEdgesToMesh.prototype as unknown as {
      getSharedOverlapArea: () => number
    },
    "getSharedOverlapArea",
  )
  const expandedNodes = inputs.flatMap((input) => {
    const solver = new ExpandUnconnectedEdgesToMesh(input)
    solver.solve()
    expect(solver.solved).toBe(true)
    return solver.getOutput()
  })
  const minX = Math.min(...expandedNodes.map((n) => n.center.x - n.width / 2))
  const maxX = Math.max(...expandedNodes.map((n) => n.center.x + n.width / 2))
  const minY = Math.min(...expandedNodes.map((n) => n.center.y - n.height / 2))
  const maxY = Math.max(...expandedNodes.map((n) => n.center.y + n.height / 2))
  const graphics = {
    rects: expandedNodes.map((node) => ({
      center: node.center,
      width: node.width,
      height: node.height,
      fill: "rgba(0,120,255,0.3)",
    })),
    texts: [
      {
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2,
        text: `overlap checks: ${overlapScan.mock.calls.length}`,
        fontSize: (maxX - minX) / 30,
        anchorSide: "center" as const,
      },
    ],
  }
  expect(
    getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path)
})
