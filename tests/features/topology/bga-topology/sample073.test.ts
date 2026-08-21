import { expect, test } from "bun:test";
import sample073 from "./sample073.srj.json" with { type: "json" };
import { getComponentTopologySvg } from "./getComponentTopologySvg";
import type { SimpleRouteJson } from "lib/types";

test("pipeline7 sample073 component topology snapshot", () => {
  expect(
    getComponentTopologySvg(sample073 as SimpleRouteJson),
  ).toMatchSvgSnapshot(import.meta.path);
});
