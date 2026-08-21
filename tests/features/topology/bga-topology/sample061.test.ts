import { expect, test } from "bun:test";
import sample061 from "./sample061.srj.json" with { type: "json" };
import { getComponentTopologySvg } from "./getComponentTopologySvg";
import type { SimpleRouteJson } from "lib/types";

test("pipeline7 sample061 component topology snapshot", () => {
  expect(
    getComponentTopologySvg(sample061 as SimpleRouteJson),
  ).toMatchSvgSnapshot(import.meta.path);
});
