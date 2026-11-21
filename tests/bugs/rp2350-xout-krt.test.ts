import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { KrtAutoroutingPipelineSolver } from "lib/testing/KrtAutoroutingPipelineSolver"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import fixture from "../../fixtures/bug-reports/rp2350-xout-krt/input.srj.json"

test("KRT cannot escape the RP2350 XOUT pad between XIN and DVDD2", async (): Promise<void> => {
  const input = structuredClone(fixture) as SimpleRouteJson
  const solver = new KrtAutoroutingPipelineSolver(input)
  expect(() => solver.solve()).toThrow(/found no route for connection source_net_29 segment 0/)
  const graphics = convertSrjToGraphicsObject(input)
  graphics.points = []
  await expect(
    getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path)
})
