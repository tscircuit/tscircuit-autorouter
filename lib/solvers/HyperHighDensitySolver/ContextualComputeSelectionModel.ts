import type { SimpleRouteJson } from "lib/types/srj-types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { getConnectionPortPointPairs } from "lib/utils/getConnectionPortPointPairs"

export type ComputeSelectionObservation = {
  nodeId: string
  features: number[]
  strategy: string
  work: number
  elapsedMs: number
  outcome: "valid" | "invalid" | "failed" | "censored"
}

export type ComputeSelectionPrediction = {
  exposure: number
  validEvents: number
  score: number
}

export const computeSelectionFeatureNames = [
  "logPortCount",
  "logRootCount",
  "logAreaInClearanceUnits",
  "absoluteLogAspectRatio",
  "transitionFraction",
  "logLayerCount",
] as const

// A fixed workspace bound, independent of board identity or benchmark data.
export const COMPUTE_SELECTION_SUPPORT_PER_STRATEGY = 64

export const getComputeSelectionFeatures = (
  node: NodeWithPortPoints,
  traceWidth: number,
  obstacleMargin: number,
): number[] => {
  if (
    !Number.isFinite(node.width) || node.width <= 0 ||
    !Number.isFinite(node.height) || node.height <= 0 ||
    !Number.isFinite(traceWidth) || traceWidth <= 0 ||
    !Number.isFinite(obstacleMargin) || obstacleMargin < 0
  ) {
    throw new Error("Compute selection received invalid cell dimensions or clearance")
  }
  const portsByConnection = new Map<string, NodeWithPortPoints["portPoints"]>()
  for (const port of node.portPoints) {
    const ports = portsByConnection.get(port.connectionName) ?? []
    ports.push(port)
    portsByConnection.set(port.connectionName, ports)
  }
  const pairs = node.portPointsInPairs?.length
    ? node.portPointsInPairs
    : [...portsByConnection.values()].flatMap(getConnectionPortPointPairs)
  const transitions = pairs.filter(([a, b]) => a.z !== b.z).length
  const pitch = traceWidth + obstacleMargin
  return [
    Math.log1p(node.portPoints.length),
    Math.log1p(new Set(node.portPoints.map((p) =>
      p.rootConnectionName ?? p.connectionName,
    )).size),
    Math.log1p(node.width * node.height / (pitch * pitch)),
    Math.abs(Math.log(node.width / node.height)),
    transitions / Math.max(1, pairs.length),
    Math.log1p(new Set(node.availableZ ?? node.portPoints.map((p) => p.z)).size),
  ]
}

/**
 * A board-local, kernel-weighted survival model. A physically clean local
 * solution is an event. Structurally valid native winners awaiting global
 * clearance repair are censored, not rejected. Exhausted, invalid, and
 * interrupted candidates contribute observed
 * time without pretending that their time-to-valid-solution was observed.
 * Gamma(1, 1ms) supplies the same finite prior for every strategy. Observations
 * include candidate construction, execution and physical acceptance costs.
 * Only the 64 most recent records of each strategy support predictions; total
 * outcome and cost counters retain every observation from this board.
 * The objective is elapsed time to physically usable node output. Full-board
 * repair and export remain separate measured costs, not fabricated labels.
 */
export class ContextualComputeSelectionModel {
  constructor(readonly copperRules: Readonly<Pick<SimpleRouteJson, "allowBlindAndBuriedVias" | "allowViaInPad" | "defaultObstacleMargin" | "minTraceToPadEdgeClearance" | "minTraceToHoleEdgeClearance" | "minViaEdgeToPadEdgeClearance">> = {}) {}
  private readonly supportByStrategy = new Map<string, ComputeSelectionObservation[]>()
  private observationCount = 0
  private observedNodeCount = 0
  private validOutcomeCount = 0
  private censoredOutcomeCount = 0
  private invalidOutcomeCount = 0
  private failedOutcomeCount = 0
  private elapsedMs = 0
  private portfolioWork = 0
  private observedWinnerOracleWork = 0
  private portfolioWorkOnValidNodes = 0
  private learnedDecisionCount = 0
  private kernelEvaluationCount = 0
  private predictionCount = 0
  private predictionElapsedMs = 0
  private validationCount = 0
  private validationElapsedMs = 0
  private portfolioOverheadMs = 0

  recordDecision(decisionCount = 1): void {
    if (!Number.isInteger(decisionCount) || decisionCount < 0) {
      throw new Error("Compute selection received an invalid decision count")
    }
    this.learnedDecisionCount += decisionCount
  }

  recordValidation(elapsedMs: number): void {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
      throw new Error("Compute selection received invalid validation timing")
    }
    this.validationCount += 1
    this.validationElapsedMs += elapsedMs
  }

  recordPortfolioOverhead(elapsedMs: number): void {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
      throw new Error("Compute selection received invalid overhead timing")
    }
    this.portfolioOverheadMs += elapsedMs
  }

  predict(features: readonly number[], strategy: string): ComputeSelectionPrediction {
    const startedAt = performance.now()
    if (
      features.length !== computeSelectionFeatureNames.length ||
      !features.every(Number.isFinite)
    ) {
      throw new Error("Compute selection received invalid prediction features")
    }
    let exposure = 1
    let validEvents = 1
    for (const observation of this.supportByStrategy.get(strategy) ?? []) {
      this.kernelEvaluationCount += 1
      let squaredDistance = 0
      for (let index = 0; index < features.length; index++) {
        squaredDistance += (features[index]! - observation.features[index]!) ** 2
      }
      const weight = Math.exp(-squaredDistance / 2)
      exposure += weight * Math.max(0.001, observation.elapsedMs)
      if (observation.outcome === "valid") validEvents += weight
    }
    this.predictionCount += 1
    this.predictionElapsedMs += performance.now() - startedAt
    return { exposure, validEvents, score: exposure / validEvents }
  }

  observeNode(observations: ComputeSelectionObservation[]): void {
    if (observations.length === 0) return
    this.observedNodeCount += 1
    if (observations.some((observation) => observation.outcome === "valid")) {
      this.portfolioWorkOnValidNodes += observations.reduce(
        (total, observation) => total + observation.work,
        0,
      )
    }
    for (const observation of observations) {
      if (
        !Number.isFinite(observation.work) || observation.work <= 0 ||
        !Number.isFinite(observation.elapsedMs) || observation.elapsedMs < 0 ||
        observation.features.length !== computeSelectionFeatureNames.length ||
        !observation.features.every(Number.isFinite)
      ) {
        throw new Error("Compute selection received an invalid observation")
      }
      const support = this.supportByStrategy.get(observation.strategy) ?? []
      support.push({
        ...observation,
        features: [...observation.features],
      })
      if (support.length > COMPUTE_SELECTION_SUPPORT_PER_STRATEGY) support.shift()
      this.supportByStrategy.set(observation.strategy, support)
      this.observationCount += 1
      this.elapsedMs += observation.elapsedMs
      this.portfolioWork += observation.work
      if (observation.outcome === "valid") {
        this.validOutcomeCount += 1
        this.observedWinnerOracleWork += observation.work
      } else if (observation.outcome === "censored") {
        this.censoredOutcomeCount += 1
      } else if (observation.outcome === "invalid") {
        this.invalidOutcomeCount += 1
      } else {
        this.failedOutcomeCount += 1
      }
    }
  }

  getStats(): Record<string, number> {
    return {
      learnedComputeObservedNodeCount: this.observedNodeCount,
      learnedComputeObservationCount: this.observationCount,
      learnedComputeSupportRecordCount: [...this.supportByStrategy.values()].reduce(
        (total, support) => total + support.length,
        0,
      ),
      learnedComputeValidOutcomeCount: this.validOutcomeCount,
      learnedComputeCensoredOutcomeCount: this.censoredOutcomeCount,
      learnedComputeInvalidOutcomeCount: this.invalidOutcomeCount,
      learnedComputeFailedOutcomeCount: this.failedOutcomeCount,
      learnedComputeElapsedMs: this.elapsedMs,
      learnedComputePortfolioWork: this.portfolioWork,
      learnedComputeObservedWinnerOracleWork: this.observedWinnerOracleWork,
      learnedComputePortfolioWorkOnValidNodes: this.portfolioWorkOnValidNodes,
      learnedComputeDecisionCount: this.learnedDecisionCount,
      learnedComputeKernelEvaluationCount: this.kernelEvaluationCount,
      learnedComputePredictionCount: this.predictionCount,
      learnedComputePredictionElapsedMs: this.predictionElapsedMs,
      learnedComputeValidationCount: this.validationCount,
      learnedComputeValidationElapsedMs: this.validationElapsedMs,
      learnedComputePortfolioOverheadMs: this.portfolioOverheadMs,
    }
  }

  getEvidence(): {
    objective: string
    workUnit: string
    oracleScope: string
    supportPerStrategy: number
    observationRetention: string
    modelScope: string
    featureNames: readonly string[]
    observations: ComputeSelectionObservation[]
    stats: Record<string, number>
  } {
    return {
      objective: "elapsed time to physically clean local node output, including construction and validation; native winners awaiting global clearance repair are censored; later board repair measured separately",
      workUnit: "search iterations (A13: routingIterations) / MIN_SUBSTEPS; constructor-only outcomes charge one acceptance unit",
      oracleScope: "observed valid winner alone; censored competitors' completion costs are unknown",
      supportPerStrategy: COMPUTE_SELECTION_SUPPORT_PER_STRATEGY,
      observationRetention: "most recent per strategy; aggregate counters include all observations",
      modelScope: "one board-local host model; adaptive detailed routing stays serial across runtime entrypoints",
      featureNames: computeSelectionFeatureNames,
      observations: [...this.supportByStrategy.values()].flat().map((observation) => ({
        ...observation,
        features: [...observation.features],
      })),
      stats: this.getStats(),
    }
  }
}
