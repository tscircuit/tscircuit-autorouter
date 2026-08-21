import { expect, test } from "bun:test";
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph";
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios";

const FULLY_PRELOADED_SAMPLE_3_CONNECTIONS = [
  "source_trace_15",
  "source_trace_19",
  "source_net_6",
];

test("Pipeline9 uses serialized connectivity for preloaded SRJ23 sample 3 traces", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj23", 3);
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  );

  solver.solve();

  expect(solver.solved).toBeTrue();
  expect(solver.failed).toBeFalse();
  const routedConnectionNames = new Set(
    solver.netToPointPairsSolver?.newConnections.map(
      (connection) => connection.name,
    ),
  );
  for (const completePreloadedConnection of FULLY_PRELOADED_SAMPLE_3_CONNECTIONS) {
    expect(routedConnectionNames.has(completePreloadedConnection)).toBeFalse();
  }

  const preloadedTraces = scenario.traces ?? [];
  expect(
    preloadedTraces.every((trace) => trace.connectsTo !== undefined),
  ).toBeTrue();
  for (const newConnection of solver.netToPointPairsSolver?.newConnections ??
    []) {
    const newPointIds = new Set(
      newConnection.pointsToConnect
        .map((point) => point.pointId)
        .filter((pointId): pointId is string => Boolean(pointId)),
    );
    const rootConnectionNames = new Set(
      newConnection.__rootConnectionNames ?? [newConnection.name],
    );
    const duplicatesPreloadedPair = preloadedTraces.some(
      (trace) =>
        rootConnectionNames.has(trace.connection_name) &&
        (trace.connectsTo ?? []).filter((pointId) => newPointIds.has(pointId))
          .length >= 2,
    );
    expect(duplicatesPreloadedPair).toBeFalse();
  }

  const outputTraces = solver.getOutputSimpleRouteJson().traces ?? [];
  for (const completePreloadedConnection of FULLY_PRELOADED_SAMPLE_3_CONNECTIONS) {
    expect(
      outputTraces.filter(
        (trace) => trace.connection_name === completePreloadedConnection,
      ),
    ).toHaveLength(1);
  }
});
