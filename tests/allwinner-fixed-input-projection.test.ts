import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { projectAllwinnerInput } from "./fixtures/allwinner-t113/projectAllwinnerInput"
import manifest from "./fixtures/allwinner-t113/manifest.json"

test("the frozen Allwinner source regenerates the same common routing problem", () => {
  const fixtureRoot = new URL("./fixtures/allwinner-t113/", import.meta.url)
  const sourceBytes = gunzipSync(
    new Uint8Array(readFileSync(new URL("frozen-source.srj.json.gz", fixtureRoot))),
  )
  expect(createHash("sha256").update(new Uint8Array(sourceBytes)).digest("hex")).toBe(
    manifest.source.uncompressedSha256,
  )
  const projected = projectAllwinnerInput(JSON.parse(sourceBytes.toString()))
  const bytes = `${JSON.stringify(projected, null, 2)}\n`
  expect(bytes).toBe(
    readFileSync(new URL(manifest.inputFile, fixtureRoot), "utf8"),
  )
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    manifest.inputSha256,
  )
  expect(projected.connections).toHaveLength(138)
  expect(projected.obstacles).toHaveLength(699)
  expect(projected.connections.flatMap((c) => c.pointsToConnect)).toHaveLength(434)
  expect(projected.obstacles.filter((o) => o.connectedTo.length)).toHaveLength(434)
  expect(projected.obstacles.filter((o) => !o.connectedTo.length)).toHaveLength(265)
  expect(projected.obstacles.every((o) => o.type === "rect")).toBe(true)
  expect(projected.layerCount).toBe(2)
  expect(projected.traces).toEqual([])
  // A connector through pad is electrically available on both outer layers.
  expect(
    projected.connections.flatMap((c) => c.pointsToConnect).some(
      (point) => "layers" in point && point.layers.join(",") === "top,bottom",
    ),
  ).toBe(true)
  // Original 270-degree pad: its global XY bounding dimensions must be swapped.
  const source = JSON.parse(sourceBytes.toString())
  const originalRotated = source.obstacles.find(
    (o: { ccwRotationDegrees?: number }) => o.ccwRotationDegrees === 270,
  )
  const resultRotated = projected.obstacles.find(
    (o) => o.obstacleId === `allwinner_obstacle_${source.obstacles.indexOf(originalRotated)}`,
  )!
  expect(resultRotated.width).toBe(originalRotated.height)
  expect(resultRotated.height).toBe(originalRotated.width)
})
