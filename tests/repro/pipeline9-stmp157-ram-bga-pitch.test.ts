import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { BgaTopologyGeneratorSolver } from "lib/solvers/BgaTopologyGeneratorSolver/BgaTopologyGeneratorSolver"
import { ComponentDetectionSolver } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import type { SimpleRouteJson } from "lib/types"
import { getViaDimensions } from "lib/utils/getViaDimensions"

test("STMP157 DDR RAM grid with package fiducials", async (): Promise<void> => {
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
  const ram = detector
    .getOutput()
    .find((component) => component.componentId === "pcb_component_1")
  if (!ram) throw new Error("STMP157 RAM component was not detected")
  const topology = new BgaTopologyGeneratorSolver({
    inputSrj: input,
    detectedComponent: ram,
    viaDiameter: getViaDimensions(input).padDiameter,
  })
  while (!topology.initialTopologySolver?.solved) topology.step()

  await expect(
    getSvgFromGraphicsObject(topology.initialTopologySolver.visualize(), {
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
