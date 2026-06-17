import { expect, test } from "bun:test"
import sample116 from "./sample116.srj.json" with { type: "json" }
import { getComponentTopologySvg } from "./getComponentTopologySvg"
import type { SimpleRouteJson } from "lib/types"

test("pipeline7 sample116 component topology snapshot", () => {
  expect(
    getComponentTopologySvg(sample116 as SimpleRouteJson),
  ).toMatchSvgSnapshot(import.meta.path)
})
