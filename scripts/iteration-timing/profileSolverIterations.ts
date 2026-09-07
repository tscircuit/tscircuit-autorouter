import { BaseSolver as ExternalBaseSolver } from "@tscircuit/solver-utils"
import { PowerTraceExpanderSolver } from "@tscircuit/power-trace-expander"
import { ConvexRegionsSolver } from "pcb-poly-hyper-graph"
import { BaseSolver } from "../../lib/solvers/BaseSolver"

export type ProfiledSolver = {
  iterations: number
  solved: boolean
  failed: boolean
  activeSubSolver?: ProfiledSolver | null
  step(): unknown
  getSolverName?(): string
}

export type SolverIterationAttribution = {
  solverName: string
  /** Observed step calls per instance; initialization is 0. */
  localIteration: number
  /** Present when several synchronous calls to this solver blocked one root step. */
  iterationEnd?: number
  phase: "step" | "initialization"
  path: string[]
  /** Exclusive time: nested solver calls are attributed separately. */
  elapsedMs: number
}

export type SolverIterationTiming = SolverIterationAttribution & {
  rootIteration: number
  /** Wall time of the complete root step, including its nested calls. */
  elapsedMs: number
  attributions: SolverIterationAttribution[]
}

export type SolverTimingSummary = {
  solverName: string
  phase: SolverIterationAttribution["phase"]
  iterations: number
  totalMs: number
  maxMs: number
}

export type SolverIterationProfile = {
  iterations: SolverIterationTiming[]
  totalIterations: number
  maxIterationMs: number
  elapsedMs: number
  solverTimings: SolverTimingSummary[]
}

type ProfileOptions = {
  /** Retain root iterations above this duration, independently of warning policy. */
  thresholdMs?: number
  now?: () => number
  additionalSolverPrototypes?: object[]
}

type Frame = {
  solver: ProfiledSolver
  iteration: number
  path: string[]
  lastTime: number
  pendingSelfMs: number
  activeChain: ProfiledSolver[]
  canAttributeInitialization: boolean
}

type PropertyRestore = {
  target: object
  property: string
  descriptor: PropertyDescriptor | undefined
  getCurrentValue?: () => unknown
}

let profiling = false

/**
 * Profiles synchronous step() calls without changing production solver code.
 * Run in an isolated process: solver prototypes are patched only for
 * this synchronous call and are restored even when a solver throws. The external
 * base covers tiny-hypergraph and high-density-repair03; exported solvers also
 * locate the separate solver-utils versions used by polygon and power routing.
 */
export function profileSolverIterations(
  root: ProfiledSolver,
  options: ProfileOptions = {},
): SolverIterationProfile {
  if (profiling)
    throw new Error("A solver iteration profile is already running")
  const thresholdMs = options.thresholdMs ?? 100
  if (!Number.isFinite(thresholdMs) || thresholdMs < 0) {
    throw new Error("thresholdMs must be a finite non-negative number")
  }
  const now = options.now ?? (() => performance.now())
  const restores: PropertyRestore[] = []
  const patchedPrototypes = new Set<object>()
  const observedSolvers = new WeakSet<object>()
  const assignedSolvers = new WeakSet<object>()
  const solverNames = new WeakMap<object, string>()
  const stepCounts = new WeakMap<ProfiledSolver, number>()
  const frames: Frame[] = []
  const summaries = new Map<string, SolverTimingSummary>()
  const summaryIterations = new WeakMap<
    ProfiledSolver,
    Map<string, { iteration: number; elapsedMs: number }>
  >()
  let attributions = new Map<
    ProfiledSolver,
    Map<string, SolverIterationAttribution>
  >()
  const result: SolverIterationProfile = {
    iterations: [],
    totalIterations: 0,
    maxIterationMs: 0,
    elapsedMs: 0,
    solverTimings: [],
  }

  function solverName(solver: ProfiledSolver): string {
    let name = solverNames.get(solver)
    if (name === undefined) {
      name = solver.getSolverName?.() ?? solver.constructor.name
      solverNames.set(solver, name)
    }
    return name
  }

  function record(
    solver: ProfiledSolver,
    phase: SolverIterationAttribution["phase"],
    iteration: number,
    path: string[],
    elapsedMs: number,
  ): void {
    if (elapsedMs <= 0) return
    let byPhase = attributions.get(solver)
    if (!byPhase) {
      byPhase = new Map()
      attributions.set(solver, byPhase)
    }
    const existing = byPhase.get(phase)
    if (existing) {
      existing.elapsedMs += elapsedMs
      if (iteration !== existing.localIteration) {
        existing.iterationEnd = Math.max(existing.iterationEnd ?? 0, iteration)
        existing.localIteration = Math.min(existing.localIteration, iteration)
      }
    } else {
      byPhase.set(phase, {
        solverName: solverName(solver),
        phase,
        localIteration: iteration,
        path,
        elapsedMs,
      })
    }
    const key = `${solverName(solver)}:${phase}`
    let previousIterations = summaryIterations.get(solver)
    if (!previousIterations) {
      previousIterations = new Map()
      summaryIterations.set(solver, previousIterations)
    }
    const previous = previousIterations.get(phase)
    const sameIteration = previous?.iteration === iteration
    const iterationMs = elapsedMs + (sameIteration ? previous.elapsedMs : 0)
    previousIterations.set(phase, { iteration, elapsedMs: iterationMs })
    const summary = summaries.get(key)
    if (summary) {
      if (!sameIteration) summary.iterations++
      summary.totalMs += elapsedMs
      summary.maxMs = Math.max(summary.maxMs, iterationMs)
    } else {
      summaries.set(key, {
        solverName: solverName(solver),
        phase,
        iterations: 1,
        totalMs: elapsedMs,
        maxMs: elapsedMs,
      })
    }
  }

  function observeSolver(solver: ProfiledSolver): void {
    if (observedSolvers.has(solver)) return
    observedSolvers.add(solver)
    patchStepPrototype(solver)
    const descriptor = Object.getOwnPropertyDescriptor(
      solver,
      "activeSubSolver",
    )
    if (
      descriptor &&
      (!descriptor.configurable || descriptor.get || descriptor.set)
    ) {
      throw new Error(`Cannot observe ${solverName(solver)}.activeSubSolver`)
    }
    let active = solver.activeSubSolver
    restores.push({
      target: solver,
      property: "activeSubSolver",
      descriptor,
      getCurrentValue: (): unknown => active,
    })
    Object.defineProperty(solver, "activeSubSolver", {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get: (): ProfiledSolver | null | undefined => active,
      set: (next: ProfiledSolver | null | undefined): void => {
        // Reaffirming the active child does not end its current time interval.
        if (next === active) return
        const firstAssignment = next && !assignedSolvers.has(next)
        const affectedFrames = frames.filter(
          (frame) =>
            frame.solver === solver || frame.activeChain.includes(solver),
        )
        const assignedAt = now()
        for (const frame of affectedFrames) {
          // Ancestors are paused inside the current call: their pending self
          // time excludes that nested call and must not be charged twice.
          if (frame === frames.at(-1)) {
            frame.pendingSelfMs += assignedAt - frame.lastTime
            frame.lastTime = assignedAt
          }
          if (
            frame.solver === solver &&
            frame.canAttributeInitialization &&
            firstAssignment &&
            next
          ) {
            const activeChain = getActiveChain(next)
            const deepest = activeChain.at(-1) ?? next
            const path = [
              ...frame.path,
              solverName(next),
              ...activeChain.map(solverName),
            ]
            // A construction-only transition includes parameter preparation.
            // After a clear/replacement, retain parent work under the parent:
            // a child's initialization whitelist must not cover teardown.
            record(deepest, "initialization", 0, path, frame.pendingSelfMs)
            frame.pendingSelfMs = 0
          } else {
            const isReplacement = frame.solver === solver && firstAssignment
            recordPendingSelf(frame, Boolean(isReplacement))
          }
          frame.canAttributeInitialization = false
        }
        active = next
        if (next) {
          assignedSolvers.add(next)
          observeSolver(next)
        }
        for (const frame of affectedFrames) {
          frame.activeChain = getActiveChain(frame.solver)
        }
      },
    })
    if (active) {
      assignedSolvers.add(active)
      observeSolver(active)
    }
  }

  function getActiveChain(solver: ProfiledSolver): ProfiledSolver[] {
    const chain: ProfiledSolver[] = []
    const visited = new Set<ProfiledSolver>([solver])
    let child = solver.activeSubSolver
    while (child && !visited.has(child)) {
      visited.add(child)
      chain.push(child)
      child = child.activeSubSolver
    }
    if (child) throw new Error("Cycle in the active subsolver chain")
    return chain
  }

  function recordPendingSelf(frame: Frame, forceParent = false): void {
    const activeChain = forceParent ? [] : frame.activeChain
    const deepest = activeChain.at(-1) ?? frame.solver
    const iteration =
      deepest === frame.solver
        ? frame.iteration
        : (stepCounts.get(deepest) ?? deepest.iterations)
    record(
      deepest,
      iteration === 0 ? "initialization" : "step",
      iteration,
      [...frame.path, ...activeChain.map(solverName)],
      frame.pendingSelfMs,
    )
    frame.pendingSelfMs = 0
  }

  function patchStepPrototype(target: object): void {
    let owner: object | null = target
    while (owner && !Object.hasOwn(owner, "step")) {
      owner = Object.getPrototypeOf(owner)
    }
    if (!owner || patchedPrototypes.has(owner)) return
    const descriptor = Object.getOwnPropertyDescriptor(owner, "step")!
    if (typeof descriptor.value !== "function") {
      throw new Error("Solver step must be a method")
    }
    const original = descriptor.value as (this: ProfiledSolver) => unknown
    patchedPrototypes.add(owner)
    restores.push({ target: owner, property: "step", descriptor })
    Object.defineProperty(owner, "step", {
      ...descriptor,
      value: function (this: ProfiledSolver): unknown {
        if (this.solved || this.failed) return original.call(this)
        // An override may call super.step(); that is the same solver iteration.
        if (frames.at(-1)?.solver === this) return original.call(this)
        const startedAt = now()
        const parent = frames.at(-1)
        if (parent) {
          parent.pendingSelfMs += startedAt - parent.lastTime
        }
        observeSolver(this)
        // Some external overrides never increment this.iterations, so whitelist
        // identity must follow observed calls rather than that mutable field.
        const iteration = (stepCounts.get(this) ?? this.iterations) + 1
        stepCounts.set(this, iteration)
        const activeChain = getActiveChain(this)
        const frame: Frame = {
          solver: this,
          iteration,
          path: [...(parent?.path ?? []), solverName(this)],
          lastTime: startedAt,
          pendingSelfMs: 0,
          activeChain,
          canAttributeInitialization: activeChain.length === 0,
        }
        frames.push(frame)
        try {
          return original.call(this)
        } finally {
          const endedAt = now()
          frame.pendingSelfMs += endedAt - frame.lastTime
          recordPendingSelf(frame)
          frames.pop()
          if (parent) parent.lastTime = endedAt
        }
      },
    })
  }

  profiling = true
  try {
    for (const prototype of [
      BaseSolver.prototype,
      ExternalBaseSolver.prototype,
      ConvexRegionsSolver.prototype,
      PowerTraceExpanderSolver.prototype,
      ...(options.additionalSolverPrototypes ?? []),
    ]) {
      patchStepPrototype(prototype)
    }
    observeSolver(root)
    const startedAt = now()
    while (!root.solved && !root.failed) {
      attributions = new Map()
      const iterationStartedAt = now()
      root.step()
      const elapsedMs = now() - iterationStartedAt
      result.totalIterations++
      result.maxIterationMs = Math.max(result.maxIterationMs, elapsedMs)
      if (elapsedMs <= thresholdMs) continue
      const entries = [...attributions.values()]
        .flatMap((byPhase) => [...byPhase.values()])
        .sort((a, b) => b.elapsedMs - a.elapsedMs)
      if (entries.length === 0) {
        throw new Error("A slow root iteration had no solver attribution")
      }
      result.iterations.push({
        ...entries[0],
        rootIteration: stepCounts.get(root)!,
        elapsedMs,
        attributions: entries,
      })
    }
    result.elapsedMs = now() - startedAt
    result.solverTimings = [...summaries.values()].sort(
      (a, b) => b.maxMs - a.maxMs,
    )
    return result
  } finally {
    for (const restore of restores.reverse()) {
      if (restore.getCurrentValue) {
        const value = restore.getCurrentValue()
        if (restore.descriptor) {
          Object.defineProperty(restore.target, restore.property, {
            ...restore.descriptor,
            value,
          })
        } else {
          delete (restore.target as Record<string, unknown>)[restore.property]
          if (value !== undefined) {
            Object.defineProperty(restore.target, restore.property, {
              configurable: true,
              enumerable: true,
              writable: true,
              value,
            })
          }
        }
      } else {
        Object.defineProperty(
          restore.target,
          restore.property,
          restore.descriptor!,
        )
      }
    }
    profiling = false
  }
}
