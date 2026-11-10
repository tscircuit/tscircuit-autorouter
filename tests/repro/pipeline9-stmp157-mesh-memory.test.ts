import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { expect, test } from "bun:test"
import { type GraphicsObject, getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getStmp157CompletedMeshSnapshotSvg } from "tests/fixtures/getStmp157CompletedMeshSnapshotSvg"

test("merges the real STMP157 remaining-routing mesh without retaining every atomic cell", async (): Promise<void> => {
  const rawInput = gunzipSync(
    Uint8Array.from(
      readFileSync(
        new URL(
          "../fixtures/assets/stmp157-remaining-mesh/input.srj.json.gz",
          import.meta.url,
        ),
      ),
    ),
  )
  expect(
    createHash("sha256").update(Uint8Array.from(rawInput)).digest("hex"),
  ).toBe("783738f1ce719d1aa83faa4a5dccd7ba22cc0ed77768b9e081ff9be568e8d7ac")
  const inputSrj: SimpleRouteJson = JSON.parse(rawInput.toString("utf8"))
  expect(inputSrj.layerCount).toBe(8)
  expect(inputSrj.obstacles).toHaveLength(3449)
  expect(inputSrj.connections).toHaveLength(40)

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    effort: 1,
    cacheProvider: null,
  })
  // Bound retained cells rather than time or RSS so the broken version is safe
  // to run in CI. This is a diagnostic stop, never a successful partial solve.
  const retainedRegionLimit = 250_000
  while (!solver.solved && !solver.failed) {
    const merger = solver.topologyMergingSolver
    if (
      merger &&
      (merger.solved || merger.stats.atomicRegionCount >= retainedRegionLimit)
    ) {
      break
    }
    solver.step()
  }
  const merger = solver.topologyMergingSolver!
  expect(merger).toBeDefined()
  const graphics: GraphicsObject = convertSrjToGraphicsObject(inputSrj)
  const status = merger.solved
    ? "Mesh completed"
    : "Stopped at retained-cell cap"
  const minX = Math.min(
    ...inputSrj.obstacles.map(
      (obstacle) => obstacle.center.x - obstacle.width / 2,
    ),
  )
  const maxY = Math.max(
    ...inputSrj.obstacles.map(
      (obstacle) => obstacle.center.y + obstacle.height / 2,
    ),
  )
  graphics.texts = [
    {
      x: minX,
      y: maxY + 4,
      text: "STMP157 remaining-routing INPUT (40 nets)",
      fontSize: 0.65,
      anchorSide: "center_left",
    },
    {
      x: minX,
      y: maxY + 2,
      text: `${status}; slabs ${merger.stats.processedXSlabCount}/${merger.stats.xSlabCount}; computed cells ${merger.stats.atomicRegionCount}`,
      fontSize: 0.65,
      anchorSide: "center_left",
      color: merger.solved ? "green" : "red",
    },
  ]
  // The drawing shows the exact input and measured stage status. A memory fix
  // should preserve copper geometry, so this is not a routing-quality claim.
  await expect(
    getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path, { tolerance: 0 })

  expect(solver.failed, solver.error ?? "").toBe(false)
  expect(merger.solved).toBe(true)
  expect(merger.stats.atomicRegionCount).toBeLessThan(retainedRegionLimit)
  expect(merger.getOutput()).toHaveLength(115881)
  expect(
    createHash("sha256")
      .update(JSON.stringify(merger.getOutput()))
      .digest("hex"),
  ).toBe("47d8fdefcebe030fe5155b4c2170bbdd23e7d154208f339d4b940b18285867fe")
  await expect(getStmp157CompletedMeshSnapshotSvg(merger)).toMatchSvgSnapshot(
    import.meta.path,
    { svgName: "completed-topology", tolerance: 0 },
  )
  expect(merger.computeProgress()).toBe(1)
  expect(merger["atomicRegions"]).toHaveLength(0)
  expect(merger["preparedNodes"]).toHaveLength(0)
  expect(merger["preparedNodeBySourceKey"].size).toBe(0)
  expect(merger["xCoordinates"]).toHaveLength(0)
  expect(merger["horizontalRegionByBucket"].size).toBe(0)
  expect(merger["overruledTargetSourceKeys"].size).toBe(0)
  expect(merger["outputProvenance"].groupIndexesByNodeId.size).toBe(0)
  expect(merger["outputProvenance"].sourceKeysByNodeId.size).toBe(0)
})
