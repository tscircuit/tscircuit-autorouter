import { sample001 } from "@tscircuit/dataset-srj29-ddr3-bga-pairs";
import { expect, test } from "bun:test";
import { AutoroutingPipelineSolver10_BgaFanout } from "lib/autorouter-pipelines/AutoroutingPipeline10_BgaFanout/AutoroutingPipelineSolver10_BgaFanout";
import type { SimpleRouteJson } from "lib/types";
import { extractBenchmarkStageTiming } from "../scripts/benchmark/benchmark-stage-timing";

test("Pipeline 10 exposes autorouter benchmark stage timings", () => {
  const pipeline = new AutoroutingPipelineSolver10_BgaFanout(
    sample001 as SimpleRouteJson,
  );

  expect(pipeline.currentPipelineStepIndex).toBe(0);
  expect(pipeline.startTimeOfPhase).toBe(pipeline.startTimeOfStage);
  expect(pipeline.timeSpentOnPhase).toBe(pipeline.timeSpentOnStage);
  expect(extractBenchmarkStageTiming(pipeline, "partial")).toEqual({
    status: "partial",
    stages: [],
  });
});
