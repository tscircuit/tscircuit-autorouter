import {
  convertToCircuitJson,
  createPcbBoardElement,
} from "lib/testing/utils/convertToCircuitJson";
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types";

type SolverLike = {
  netToPointPairsSolver?: {
    getNewSimpleRouteJson?: () => any;
  };
  srjWithPointPairs?: any;
  originalSrj?: SimpleRouteJson;
  getOutputSimplifiedPcbTraces: () => SimplifiedPcbTrace[];
  srj: SimpleRouteJson;
};

export const getCurrentCircuitJson = (
  solver: SolverLike,
  onError?: (message: string) => void,
) => {
  const srjWithPointPairs =
    solver.netToPointPairsSolver?.getNewSimpleRouteJson?.() ||
    solver.srjWithPointPairs;

  if (!srjWithPointPairs) {
    onError?.(
      "No connection information available yet. Wait until point-pair generation completes.",
    );
    return null;
  }

  const routedTraces = solver.getOutputSimplifiedPcbTraces();
  if (!routedTraces) {
    onError?.(
      "No routed traces available yet. Run routing first, then try again.",
    );
    return null;
  }
  const inputSrj = solver.originalSrj ?? solver.srj;
  const jointTraces = [...(inputSrj.traces ?? []), ...routedTraces];

  const circuitJson = convertToCircuitJson(srjWithPointPairs, jointTraces, {
    minTraceWidth: inputSrj.minTraceWidth,
    originalSrj: inputSrj,
    includeOriginalConnections: (inputSrj.traces?.length ?? 0) > 0,
  });

  return [createPcbBoardElement(inputSrj), ...circuitJson];
};
