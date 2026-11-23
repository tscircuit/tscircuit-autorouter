import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import bugReport from "../../fixtures/bug-reports/bugreport135-cb1e6e/bugreport135-cb1e6e.json" with {
  type: "json",
}

const srj = bugReport.simple_route_json as SimpleRouteJson

// The pipeline currently fails on this input (see reproduce.ts next to the
// fixture); this snapshot records the board-level routing input.
test("bugreport135-cb1e6e board routing input", async (): Promise<void> => {
  const svg: string = getSvgFromGraphicsObject(convertSrjToGraphicsObject(srj), {
    backgroundColor: "white",
    svgWidth: 1200,
    svgHeight: 760,
  })
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
