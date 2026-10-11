import type { DrcError } from "high-density-repair03/lib"
import type { SimpleRouteJson } from "high-density-repair03/lib/types"
import type { HighDensityRoute } from "high-density-repair03/lib/types/high-density-types"
import type { Pipeline9PreparedIndexedDrcEvaluation, Pipeline9PreparedJointDrcContext } from "./createPreparedJointDrcEvaluation"
import type { Pipeline9NativeGlobalDrcContext, Pipeline9NativeGlobalDrcExceptionEvaluation, Pipeline9PreparedNativeGlobalDrcEvaluation } from "./createPreparedNativeGlobalDrcEvaluation"

type TrialInput = {
  trialIndex: number
  srj: SimpleRouteJson
  hdRoutes: HighDensityRoute[]
  error: DrcError
  connectivity?: {
    connectivityNetMap: Record<string, string[]>
    connectivityIdToNetMap: Record<string, string>
  }
}

export type ParallelGlobalDrcTrial = TrialInput & (
  | {
      kind: "force-scale"
      traceRouteIndexById: Map<string, number>
      scale: number
      enableTargetedErrorSweep: boolean
      canMoveSharedViaSiteWithoutTradingDrcErrors: boolean
      enableTraceViaOwnerTargeting: boolean
    }
  | {
      kind: "safe-trace-layer"
      changedRouteIndex: number
      targetZ: number
      spanExpansion: number | "full"
      directionVariant: number
    }
)

export type ParallelGlobalDrcTrialSnapshot = Pick<TrialInput, "srj" | "hdRoutes" | "connectivity">

export type ParallelGlobalDrcTrialDescriptor =
  | Omit<Extract<ParallelGlobalDrcTrial, { kind: "force-scale" }>, keyof ParallelGlobalDrcTrialSnapshot>
  | Omit<Extract<ParallelGlobalDrcTrial, { kind: "safe-trace-layer" }>, keyof ParallelGlobalDrcTrialSnapshot>

export type ParallelGlobalDrcTrialJob = {
  kind: "globalDrcForceTrial"
  contextId: number
  snapshotId: number
  snapshot?: ParallelGlobalDrcTrialSnapshot
  trial: ParallelGlobalDrcTrialDescriptor
} & (
  | { evaluationMode: "joint"; context?: Pipeline9PreparedJointDrcContext }
  | { evaluationMode: "native"; context?: Pipeline9NativeGlobalDrcContext }
)

export type ParallelGlobalDrcTrialPlacement =
  | { status: "unchanged" }
  | {
      status: "evaluated"
      routes: HighDensityRoute[]
      preparedEvaluation: Pipeline9PreparedIndexedDrcEvaluation
    }
  | {
      status: "evaluated"
      routes: HighDensityRoute[]
      nativeEvaluation: Pipeline9PreparedNativeGlobalDrcEvaluation
    }
  | { status: "exception"; countedBeforeException: false; exception: { name: string; message: string; stack?: string } }
  | { status: "exception"; countedBeforeException: true; routes: HighDensityRoute[]; candidateKey: string;
      nativeExceptionEvaluation?: Pipeline9NativeGlobalDrcExceptionEvaluation;
      exception: { name: string; message: string; stack?: string } }

export type ParallelGlobalDrcTrialResult = {
  kind: "globalDrcForceTrial"
  trialIndex: number
  placements: ParallelGlobalDrcTrialPlacement[]
}

export type ParallelGlobalDrcTrialCoordinator = {
  dispatch(trials: ParallelGlobalDrcTrial[]): Promise<ParallelGlobalDrcTrialResult[]>
  adopt(placement: Extract<ParallelGlobalDrcTrialPlacement, { status: "evaluated" }>): void
  adoptException(placement: Extract<ParallelGlobalDrcTrialPlacement, { status: "exception"; countedBeforeException: true }>, error: Error): void
  discardPreparedEvaluation?(): void
}
