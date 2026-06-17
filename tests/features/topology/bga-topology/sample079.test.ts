import { expect, test } from "bun:test"
import sample079 from "./sample079.srj.json" with { type: "json" }
import { getComponentTopologySvg } from "./getComponentTopologySvg"
import type { SimpleRouteJson } from "lib/types"

test("pipeline7 sample079 component topology snapshot", () => {
  expect(
    getComponentTopologySvg(sample079 as SimpleRouteJson),
  ).toMatchSvgSnapshot(import.meta.path)
})
