import { gzipSync } from "node:zlib"
import type { Pipeline9JointDrcRepairSolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "../../lib/types"

type DrcReproSolver = {
  srjWithPointPairs?: SimpleRouteJson
  pipeline9JointDrcRepairSolver?: Pipeline9JointDrcRepairSolver
}

/** Preserve the runner's exact geometry when a DRC failure is platform-specific. */
export const createBenchmarkDrcRepro = ({
  inputSrj,
  solver,
  routedTraces,
}: {
  inputSrj: SimpleRouteJson
  solver: DrcReproSolver
  routedTraces: SimplifiedPcbTrace[]
}): { encoding: "gzip-base64"; data: string } => {
  const joint = solver.pipeline9JointDrcRepairSolver
  const jointParams = joint
    ? {
        ...joint.params,
        connMap: joint.params.connMap.netMap,
        mutatedPreloadedTraceIds: [...joint.params.mutatedPreloadedTraceIds],
      }
    : undefined
  return {
    encoding: "gzip-base64",
    data: gzipSync(
      JSON.stringify({
        inputSrj,
        srjWithPointPairs: solver.srjWithPointPairs,
        routedTraces,
        jointParams,
      }),
    ).toString("base64"),
  }
}
