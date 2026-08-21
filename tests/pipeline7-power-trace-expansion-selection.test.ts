import { expect, test } from "bun:test";
import type { PowerTraceExpanderOptions } from "@tscircuit/power-trace-expander";
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph";
import { getPowerTraceExpansionConnectionNames } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/getPowerTraceExpansionConnectionNames";
import type { SimpleRouteJson } from "lib/types";

test("Pipeline7 selects only connections with a significant requested width increase", () => {
  const createConnection = (name: string, nominalTraceWidth?: number) => ({
    name,
    ...(nominalTraceWidth === undefined ? {} : { nominalTraceWidth }),
    pointsToConnect: [
      { x: 0, y: 0, layer: "top" },
      { x: 10, y: 0, layer: "top" },
    ],
  });
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -1, minY: -1, maxX: 11, maxY: 1 },
    obstacles: [],
    differentialPairs: [
      { connectionNames: ["USB_P", "USB_N"], lengthTolerance: 0.05 },
    ],
    connections: [
      createConnection("USB_P", 0.15),
      createConnection("USB_N", 0.15),
      createConnection("WIDE_SIGNAL", 0.25),
      createConnection("POWER", 0.5),
    ],
  };

  expect(getPowerTraceExpansionConnectionNames(srj)).toEqual(["POWER"]);

  const solver = new AutoroutingPipelineSolver7_MultiGraph(srj);
  const powerStep = solver.pipelineDef.find(
    (step) => step.solverName === "powerTraceExpansionSolver",
  )!;
  const defaultOptions = powerStep.getConstructorParams({
    ...solver,
    getPrePowerTraceOutputSimplifiedPcbTraces: () => [],
  } as any)[1] as PowerTraceExpanderOptions;
  expect(defaultOptions.onlyConnectionNames).toEqual(["POWER"]);

  const explicitlyTargetedSolver = new AutoroutingPipelineSolver7_MultiGraph(
    srj,
    { powerTraceExpansion: { onlyConnectionNames: ["USB_P"] } },
  );
  const explicitPowerStep = explicitlyTargetedSolver.pipelineDef.find(
    (step) => step.solverName === "powerTraceExpansionSolver",
  )!;
  const explicitOptions = explicitPowerStep.getConstructorParams({
    ...explicitlyTargetedSolver,
    getPrePowerTraceOutputSimplifiedPcbTraces: () => [],
  } as any)[1] as PowerTraceExpanderOptions;
  expect(explicitOptions.onlyConnectionNames).toEqual(["USB_P"]);
});
