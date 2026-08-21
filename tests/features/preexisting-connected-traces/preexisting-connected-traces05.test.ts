import { expect, test } from "bun:test";
import type { SimpleRouteJson } from "lib/types";
import { solveAndSnapshot } from "./fixtures";
import scenario from "./srj/preexisting-connected-traces05.srj.json" with { type: "json" };

test(
  "Pipeline7 trace connectsTo only suppresses edges on the matching net",
  () => {
    const srj = structuredClone(scenario) as SimpleRouteJson;

    const { outputSrj } = solveAndSnapshot(srj, import.meta.path, {
      problem:
        "One net has a preexisting U1-R1 route; a separate U1-C1 net is not pre-routed.",
      expected: "Pipeline7 should emit one trace for each remaining net.",
    });

    expect(outputSrj.traces).toHaveLength(2);
  },
  { timeout: 60_000 },
);
