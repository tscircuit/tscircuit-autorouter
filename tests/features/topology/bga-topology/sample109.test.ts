import { expect, test } from "bun:test"
import sample109 from "./sample109.srj.json" with { type: "json" }
import { getComponentTopologySvg } from "./getComponentTopologySvg"
import type { SimpleRouteJson } from "lib/types"

test("pipeline7 sample109 component topology snapshot", () => {
  expect(
    getComponentTopologySvg(sample109 as SimpleRouteJson),
  ).toMatchSvgSnapshot(import.meta.path)
})
