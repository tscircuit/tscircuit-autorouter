import {
  LengthMatchingSolver,
  LengthMatchingNoSolutionError,
  PostProcessingSolver,
  type HighDensityRoute,
  type PostProcessingSolverParams,
} from "@tscircuit/length-matching-solver"
import { createPostProcessingModel } from "../../node_modules/@tscircuit/length-matching-solver/lib/post-processing/binding/createPostProcessingModel"
import { createLengthMatchingBinding } from "../../node_modules/@tscircuit/length-matching-solver/lib/post-processing/binding/createLengthMatchingBinding"
import { reconstructHdRoutesFromMatchingOutput } from "../../node_modules/@tscircuit/length-matching-solver/lib/post-processing/binding/reconstructHdRoutesFromMatchingOutput"
import { parseSimplifiedPcbTrace } from "../../node_modules/@tscircuit/length-matching-solver/lib/post-processing/model/parseSimplifiedPcbTrace"
import { createCoupledPairCandidate } from "../../node_modules/@tscircuit/length-matching-solver/lib/post-processing/routing/createCoupledPairCandidate"
import { getLayerIndex } from "../../node_modules/@tscircuit/length-matching-solver/lib/post-processing/geometry/getLayerIndex"
import { getLayerName } from "../../node_modules/@tscircuit/length-matching-solver/lib/post-processing/geometry/getLayerName"
import { getObstaclesFromSrjTraces } from "../../lib/utils/convertSrjTracesToObstacles"
import { createAFamilySpine, type AFamilySpineInput } from "./aFamilySpine"
import { bFamilySpine } from "./bFamilySpine"
import { prepareSpineTerminals } from "./prepareSpineTerminals"
import {
  validateExpandedPair,
  type ExpandedPairConstraint,
  type ExpandedPairValidation,
} from "./validateExpandedPair"

export type PairStrategy = "joint" | "a" | "b"
export type PortfolioInput = {
  params: PostProcessingSolverParams
  constraints?: ExpandedPairConstraint[]
  strategies: PairStrategy[]
  budgetMs: number
  maxSteps?: number
}
export type StrategyResult = {
  strategy: PairStrategy
  hdRoutes: HighDensityRoute[]
  validation: ExpandedPairValidation
  notes: string[]
  acceptedPairCount: number
  generatedCandidateCount: number
}
export type PortfolioResult = {
  status: "valid" | "best-effort"
  winner: PairStrategy | null
  hdRoutes: HighDensityRoute[]
  elapsedMs: number
  steps: number
  candidates: Omit<StrategyResult, "hdRoutes">[]
  unfinished: PairStrategy[]
}
type StrategyGenerator = Generator<null, StrategyResult, void>

/** Run a single existing joint pipeline, retaining its output even on a quality miss. */
function* jointStrategy(input: PortfolioInput): StrategyGenerator {
  const solver = new PostProcessingSolver(input.params)
  while (!solver.solved && !solver.failed) {
    solver.step()
    yield null
  }
  if (solver.failed)
    throw new Error(
      solver.error ?? "Joint pipeline failed without a diagnostic",
    )
  const output = solver.getOutput()
  return {
    strategy: "joint",
    acceptedPairCount: 0,
    generatedCandidateCount: 0,
    hdRoutes: output.hdRoutes,
    validation: validateExpandedPair({
      params: input.params,
      candidateHdRoutes: output.hdRoutes,
      constraints: input.constraints,
    }),
    notes: output.postProcessingErrors.map((error) => error.message),
  }
}

/** Expand real A/B search output and tune it while preserving every unrelated route. */
function* spineStrategy(
  input: PortfolioInput,
  strategy: "a" | "b",
  checkpoints: Map<PairStrategy, StrategyResult>,
): StrategyGenerator {
  let hdRoutes = structuredClone(input.params.hdRoutes)
  const notes: string[] = []
  let acceptedPairCount = 0
  let generatedCandidateCount = 0
  for (const pair of input.params.differentialPairs) {
    const params = { ...input.params, hdRoutes, differentialPairs: [pair] }
    const model = createPostProcessingModel(params)
    const srj = model.params.simpleRouteJson
    const members = pair.connectionNames.map((name) =>
      srj.traces.filter((trace) => trace.connection_name === name),
    )
    if (members.some((matches) => matches.length !== 1)) {
      notes.push(`${pair.connectionNames.join("/")}: ambiguous member binding`)
      continue
    }
    const first = parseSimplifiedPcbTrace(members[0]![0]!, params.layerCount)
    const second = parseSimplifiedPcbTrace(members[1]![0]!, params.layerCount)
    const fs = first.points[0]!,
      fe = first.points.at(-1)!,
      ss = second.points[0]!,
      se = second.points.at(-1)!
    const direct =
      Math.hypot(fs.x - ss.x, fs.y - ss.y) +
      Math.hypot(fe.x - se.x, fe.y - se.y)
    const reversed =
      Math.hypot(fs.x - se.x, fs.y - se.y) +
      Math.hypot(fe.x - ss.x, fe.y - ss.y)
    const reverseSecond = reversed < direct
    const startSecond = reverseSecond ? se : ss,
      endSecond = reverseSecond ? ss : se
    if (fs.layer !== startSecond.layer || fe.layer !== endSecond.layer) {
      notes.push("Unsupported mismatched terminal layers")
      continue
    }
    const constraint = input.constraints?.find(
      (entry) =>
        entry.connectionNames.join("\0") === pair.connectionNames.join("\0"),
    )
    const spacing =
      constraint?.traceGap !== undefined
        ? constraint.traceGap + (first.width + second.width) / 2
        : (pair.minimumCenterlineDistance ??
          (first.width + second.width) / 2 + 0.5)
    const names = new Set(pair.connectionNames)
    const terminals = prepareSpineTerminals({
      first,
      second,
      reverseSecond,
      centerlineSpacing: spacing,
      maxUncoupledLength:
        constraint?.maxUncoupledLength ?? pair.maxUncoupledLength,
      context: {
        immutableTraces: srj.traces.filter(
          (trace) => !names.has(trace.connection_name),
        ),
        obstacles: srj.obstacles,
        bounds: params.bounds,
        layerCount: params.layerCount,
        minTraceToPadEdgeClearance: params.minTraceToPadEdgeClearance,
      },
    })
    if (terminals.status === "rejected") {
      notes.push(terminals.reason)
      continue
    }
    const start = {
      x: terminals.start.x,
      y: terminals.start.y,
      z: getLayerIndex(terminals.start.layer, params.layerCount),
    }
    const end = {
      x: terminals.end.x,
      y: terminals.end.y,
      z: getLayerIndex(terminals.end.layer, params.layerCount),
    }
    // Terminal pad copper is exempt only in this provisional generator. Final lane validation checks each member against the full original board.
    const obstacles = srj.obstacles.filter(
      (obstacle) => !obstacle.connectedTo.some((name) => names.has(name)),
    )
    const fixedObstacles = getObstaclesFromSrjTraces({
      bounds: params.bounds,
      layerCount: params.layerCount,
      minTraceWidth: first.width,
      obstacles: [],
      connections: [],
      traces: params.traces,
    })
    const adapterInput: AFamilySpineInput = {
      bounds: params.bounds,
      layerCount: params.layerCount,
      start,
      end,
      traceWidth: spacing + Math.max(first.width, second.width),
      viaDiameter: spacing + Math.max(first.viaDiameter, second.viaDiameter),
      obstacles: [...obstacles, ...fixedObstacles],
      existingTraces: hdRoutes.filter(
        (route) => !names.has(route.connectionName),
      ),
      obstacleMargin:
        params.minTraceToPadEdgeClearance ??
        Math.max(first.width, second.width),
      maxSearchIterations: 75_000,
    }
    const adapter =
      strategy === "a"
        ? createAFamilySpine(adapterInput)
        : bFamilySpine(adapterInput)
    if ("status" in adapter && adapter.status === "unsupported") {
      notes.push(adapter.reason)
      continue
    }
    notes.push(...adapter.limitations)
    if (!adapter.solver) continue
    while (!adapter.solver.solved && !adapter.solver.failed) {
      adapter.solver.step()
      yield null
    }
    const path = adapter.getCandidate()
    if (!path) {
      notes.push("Spine search produced no accepted corridor")
      continue
    }
    const preferredSide = terminals.side
    for (const side of [preferredSide, -preferredSide] as (1 | -1)[]) {
      const candidate = createCoupledPairCandidate({
        first,
        second,
        reverseSecond,
        path: path.map((point) => ({
          x: point.x,
          y: point.y,
          layer: getLayerName(point.z, params.layerCount),
        })),
        centerlineSpacing: spacing,
        edgeGap: spacing - (first.width + second.width) / 2,
        side,
        layerCount: params.layerCount,
      })
      if (!candidate) continue
      generatedCandidateCount++
      const traces = srj.traces.map((trace) =>
        trace.connection_name === pair.connectionNames[0]
          ? candidate.first
          : trace.connection_name === pair.connectionNames[1]
            ? candidate.second
            : trace,
      )
      const binding = createLengthMatchingBinding({
        params: model.params,
        result: { traces, reroutedPairs: [pair] },
      })
      const matcher = new LengthMatchingSolver(binding.solverParams)
      let tuningMiss = false
      while (!matcher.solved && !matcher.failed) {
        try {
          matcher.step()
        } catch (error) {
          if (!(error instanceof LengthMatchingNoSolutionError)) throw error
          tuningMiss = true
          break
        }
        yield null
      }
      if (tuningMiss || matcher.failed) {
        notes.push("Expanded candidate could not finish length tuning")
        continue
      }
      const expanded = reconstructHdRoutesFromMatchingOutput({
        binding,
        result: matcher.getOutput(),
        model,
      }).hdRoutes
      const validation = validateExpandedPair({
        params,
        candidateHdRoutes: expanded,
        constraints: input.constraints,
      })
      if (validation.status === "valid") {
        hdRoutes = expanded
        acceptedPairCount++
        checkpoints.set(strategy, {
          strategy,
          hdRoutes,
          acceptedPairCount,
          generatedCandidateCount,
          notes: [...notes],
          validation: validateExpandedPair({
            params: input.params,
            candidateHdRoutes: hdRoutes,
            constraints: input.constraints,
          }),
        })
        break
      }
      notes.push(
        ...validation.issues.map(
          (issue) => `${pair.connectionNames.join("/")}: ${issue.code}`,
        ),
      )
      yield null
    }
  }
  return {
    strategy,
    hdRoutes,
    acceptedPairCount,
    generatedCandidateCount,
    validation: validateExpandedPair({
      params: input.params,
      candidateHdRoutes: hdRoutes,
      constraints: input.constraints,
    }),
    notes,
  }
}

/** Cooperative round-robin portfolio with one shared wall-clock budget, including tuning and validation. */
export function runPairPortfolio(input: PortfolioInput): PortfolioResult {
  if (
    !Number.isFinite(input.budgetMs) ||
    input.budgetMs <= 0 ||
    input.strategies.length === 0 ||
    (input.maxSteps !== undefined &&
      (!Number.isSafeInteger(input.maxSteps) || input.maxSteps < 1))
  )
    throw new Error(
      "Portfolio needs a positive budget and at least one strategy",
    )
  const started = performance.now()
  const originalValidation = validateExpandedPair({
    params: input.params,
    candidateHdRoutes: input.params.hdRoutes,
    constraints: input.constraints,
  })
  const checkpoints = new Map<PairStrategy, StrategyResult>()
  const active = input.strategies.map((strategy) => ({
    strategy,
    generator:
      strategy === "joint"
        ? jointStrategy(input)
        : spineStrategy(input, strategy, checkpoints),
  }))
  const candidates: StrategyResult[] = []
  let steps = 0
  let winner: StrategyResult | undefined
  while (
    active.length &&
    performance.now() - started < input.budgetMs &&
    steps < (input.maxSteps ?? 300_000)
  ) {
    for (let index = 0; index < active.length; index++) {
      const entry = active[index]!
      const quantumStarted = performance.now()
      do {
        const next = entry.generator.next()
        steps++
        if (next.done) {
          candidates.push(next.value)
          active.splice(index--, 1)
          if (
            next.value.validation.status === "valid" &&
            performance.now() - started <= input.budgetMs &&
            (next.value.strategy === "joint" ||
              next.value.acceptedPairCount > 0)
          )
            winner = next.value
          break
        }
      } while (
        performance.now() - quantumStarted < 2 &&
        performance.now() - started < input.budgetMs &&
        steps < (input.maxSteps ?? 300_000)
      )
      if (winner) break
      if (
        performance.now() - started >= input.budgetMs ||
        steps >= (input.maxSteps ?? 300_000)
      )
        break
    }
    if (winner) break
  }
  // A missed optimization never suppresses available copper. A completed joint pipeline remains the best-effort incumbent.
  const partial = [...checkpoints.values()].sort(
    (a, b) => b.acceptedPairCount - a.acceptedPairCount,
  )[0]
  const incumbent =
    winner ??
    (originalValidation.status === "valid"
      ? undefined
      : (partial ??
        candidates.find((candidate) => candidate.strategy === "joint")))
  return {
    status:
      winner || originalValidation.status === "valid" ? "valid" : "best-effort",
    winner: winner?.strategy ?? null,
    hdRoutes: incumbent?.hdRoutes ?? structuredClone(input.params.hdRoutes),
    elapsedMs: performance.now() - started,
    steps,
    candidates: candidates.map(({ hdRoutes: _, ...candidate }) => candidate),
    unfinished: active.map((entry) => entry.strategy),
  }
}
