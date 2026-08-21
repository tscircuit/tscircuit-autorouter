import { expect, test } from "bun:test";
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph";

test("Pipeline7 runs post-processing before default power expansion", () => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph({
    layerCount: 2,
    minTraceWidth: 0.15,
    minTraceToPadEdgeClearance: 0.1,
    minViaPadDiameter: 0.3,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
    obstacles: [],
    differentialPairs: [
      { connectionNames: ["PAIR_P", "PAIR_N"], lengthTolerance: 0.01 },
    ],
    connections: [
      {
        name: "PAIR_P",
        __netConnectionName: "NET_PAIR_P",
        pointsToConnect: [
          { x: 1, y: 2, layer: "top" },
          { x: 19, y: 2, layer: "top" },
        ],
      },
      {
        name: "PAIR_N",
        __netConnectionName: "NET_PAIR_N",
        pointsToConnect: [
          { x: 1, y: 6, layer: "top" },
          { x: 19, y: 6, layer: "top" },
        ],
      },
    ],
  });
  const powerTraceExpansionStep = solver.pipelineDef.at(-1);
  const lengthMatchingPostProcessingStep = solver.pipelineDef.at(-2);
  expect(powerTraceExpansionStep?.solverName).toBe("powerTraceExpansionSolver");
  expect(lengthMatchingPostProcessingStep?.solverName).toBe(
    "lengthMatchingPostProcessingSolver",
  );

  const powerTraceParams = powerTraceExpansionStep!.getConstructorParams({
    ...solver,
    getPrePowerTraceOutputSimplifiedPcbTraces: () => [],
  } as any);
  expect(powerTraceParams).toHaveLength(2);
  expect((powerTraceParams[0] as any).fixedTraces).toEqual([]);
  expect(powerTraceParams[1]).toEqual({
    allowNewVias: false,
    onlyConnectionNames: [],
  });

  const [params] = lengthMatchingPostProcessingStep!.getConstructorParams({
    ...solver,
    netToPointPairsSolver: {
      newConnections: solver.srj.connections.map((connection) => ({
        ...connection,
        name: `${connection.name}_mst0`,
        __rootConnectionNames: [connection.name],
      })),
    },
    exactGeometryDrcForceImproveSolver: {
      getOutput: () => [
        {
          connectionName: "PAIR_P_mst0",
          route: [
            { x: 1, y: 2, z: 0 },
            { x: 19, y: 2, z: 0 },
          ],
          traceThickness: 0.15,
          viaDiameter: 0.3,
          vias: [],
        },
        {
          connectionName: "PAIR_N_mst0",
          route: [
            { x: 1, y: 6, z: 0 },
            { x: 19, y: 6, z: 0 },
          ],
          traceThickness: 0.15,
          viaDiameter: 0.3,
          vias: [],
        },
      ],
    },
  } as any);

  const lengthMatchingPostProcessingParams = params as any;
  expect(Object.keys(lengthMatchingPostProcessingParams).sort()).toEqual(
    [
      "bounds",
      "differentialPairs",
      "hdRoutes",
      "layerCount",
      "obstacles",
    ].sort(),
  );
  expect(lengthMatchingPostProcessingParams.differentialPairs).toEqual([
    {
      connectionNames: ["PAIR_P_mst0", "PAIR_N_mst0"],
      lengthTolerance: 0.01,
    },
  ]);
  expect(
    lengthMatchingPostProcessingParams.hdRoutes.map(
      (route: any) => route.connectionName,
    ),
  ).toEqual(["PAIR_P_mst0", "PAIR_N_mst0"]);

  const lengthMatchingPostProcessingSolver = new (
    lengthMatchingPostProcessingStep!.solverClass as any
  )(lengthMatchingPostProcessingParams);
  lengthMatchingPostProcessingSolver.solve();
  expect(
    lengthMatchingPostProcessingSolver
      .getOutput()
      .hdRoutes.map((route: any) => route.connectionName),
  ).toEqual(["PAIR_P_mst0", "PAIR_N_mst0"]);
});
