import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { getDynamicNetTreeGraphics } from "./getDynamicNetTreeGraphics"
import {
  routeDynamicNetTreeSteps,
  type DynamicNetTreeOptions,
  type DynamicNetTreeProblem,
  type DynamicNetTreeProgress,
  type DynamicNetTreeResult,
} from "./routeDynamicNetTree"

/** One physical branch insertion per step; each search has explicit budgets. */
export class DynamicNetTreeSolver extends BaseSolver {
  private readonly problem: DynamicNetTreeProblem
  private readonly options: DynamicNetTreeOptions
  private iterator?: Generator<DynamicNetTreeProgress, DynamicNetTreeResult>
  private output?: DynamicNetTreeResult
  private events: DynamicNetTreeProgress[] = []

  constructor(problem: DynamicNetTreeProblem, options: DynamicNetTreeOptions) {
    super()
    this.problem = structuredClone(problem)
    this.options = structuredClone(options)
    this.MAX_ITERATIONS = problem.terminals.reduce((sum, t) => sum + t.layers.length, 0) + problem.copper.length + 10
  }

  override _setup(): void {
    this.iterator = routeDynamicNetTreeSteps(this.problem, this.options)
  }

  override _step(): void {
    if (!this.iterator)
      throw new Error("DynamicNetTreeSolver: missing search iterator")
    const next = this.iterator.next()
    if (next.done) {
      this.output = next.value
      this.stats = { ...next.value.stats }
      if (next.value.solved) this.solved = true
      else {
        this.failed = true
        this.error = next.value.error ?? "Dynamic net-tree search rejected"
      }
    } else {
      this.events.push(next.value)
      this.stats = {
        branches: next.value.branches,
        components: next.value.components,
        insertedVias: next.value.insertedVias,
        expansions: next.value.expansions,
      }
    }
    this.progress = this.computeProgress()
  }

  override getConstructorParams(): [
    DynamicNetTreeProblem,
    DynamicNetTreeOptions,
  ] {
    return [structuredClone(this.problem), structuredClone(this.options)]
  }

  override getOutput(): DynamicNetTreeResult {
    if (!this.output)
      throw new Error(
        "DynamicNetTreeSolver: output requested before completion",
      )
    return structuredClone(this.output)
  }

  computeProgress(): number {
    if (this.solved || this.failed) return 1
    const last = this.events.at(-1)
    return last
      ? (last.initialComponents - last.components) /
          Math.max(1, last.initialComponents - 1)
      : 0
  }

  getRecordedGraphics(): GraphicsObject {
    const frames = [
      getDynamicNetTreeGraphics(
        this.problem,
        [],
        `${this.problem.net}: original physical components`,
        0,
      ),
      ...this.events.map((event, i) =>
        getDynamicNetTreeGraphics(
          this.problem,
          event.traces,
          `${event.net}: ${event.kind} branch ${event.branches}; ${event.components} components; ${event.insertedVias} vias`,
          i + 1,
        ),
      ),
    ]
    if (this.output)
      frames.push(
        getDynamicNetTreeGraphics(
          this.problem,
          this.output.solved ? this.output.traces : [],
          `${this.problem.net}: ${this.output.solved ? "proposal complete" : `rejected: ${this.output.error}`}`,
          frames.length,
        ),
      )
    return {
      lines: frames.flatMap((g) => g.lines!),
      circles: frames.flatMap((g) => g.circles!),
      rects: frames.flatMap((g) => g.rects!),
      points: frames.flatMap((g) => g.points!),
      texts: frames.flatMap((g) => g.texts!),
    }
  }

  override visualize(): GraphicsObject {
    const event = this.events.at(-1)
    return getDynamicNetTreeGraphics(
      this.problem,
      this.output ? this.output.traces : event ? event.traces : [],
      this.output
        ? `${this.problem.net}: ${this.output.solved ? "proposal complete" : `rejected: ${this.output.error}`}`
        : event
          ? `${event.net}: ${event.kind} branch ${event.branches}; ${event.components} components; ${event.insertedVias} vias`
          : `${this.problem.net}: original physical components`,
      this.events.length + (this.output ? 1 : 0),
    )
  }

  override preview(): GraphicsObject {
    return this.visualize()
  }
}
