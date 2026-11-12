import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { getSvgFromGraphicsObject, type Rect } from "graphics-debug"
import {
  boundsIntersection,
  getBoundFromCenteredRect,
} from "@tscircuit/math-utils"
import { BgaTopologyGeneratorSolver } from "lib/solvers/BgaTopologyGeneratorSolver/BgaTopologyGeneratorSolver"
import { ComponentDetectionSolver } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import type { SimpleRouteJson } from "lib/types"
import { getViaDimensions } from "lib/utils/getViaDimensions"

test("generates the native STMP157 DDR component mesh", async (): Promise<void> => {
  const input: SimpleRouteJson = JSON.parse(
    gunzipSync(
      Uint8Array.from(
        readFileSync(
          new URL(
            "../fixtures/assets/stmp157-native-ddr-via-space/input.srj.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  )
  const detector = new ComponentDetectionSolver({ inputSrj: input })
  detector.solve()
  const cpu = detector.getOutput().find(
    (component) => component.componentId === "pcb_component_2",
  )
  if (!cpu) throw new Error("STMP157 CPU component was not detected")
  const topology = new BgaTopologyGeneratorSolver({
    inputSrj: input,
    detectedComponent: cpu,
    viaDiameter: getViaDimensions(input).padDiameter,
  })
  while (!topology.initialTopologySolver?.solved) topology.step()

  // Show slots at U1.G20 before merging masks duplicate cells.
  const graphics = topology.initialTopologySolver.visualize()
  const viewport = { minX: -8.2, maxX: -6.2, minY: 1.6, maxY: 3.6 }
  graphics.rects = graphics.rects!.flatMap((rect): Rect[] => {
    const bounds = boundsIntersection(getBoundFromCenteredRect(rect), viewport)
    if (!bounds) return []
    return [
      {
        ...rect,
        center: {
          x: (bounds.minX + bounds.maxX) / 2,
          y: (bounds.minY + bounds.maxY) / 2,
        },
        width: bounds.maxX - bounds.minX,
        height: bounds.maxY - bounds.minY,
      },
    ]
  })
  await expect(
    getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path)
})
