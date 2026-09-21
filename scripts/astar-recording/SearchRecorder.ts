import {
  closeSync,
  mkdirSync,
  openSync,
  writeFileSync,
  writeSync,
} from "node:fs"
import path from "node:path"
import type { Candidate, TinyHyperGraphSolver } from "tiny-hypergraph/lib/core"

type EventData = Record<string, unknown>
type CandidateRecord = Omit<Candidate, "prevCandidate"> & {
  id: number
  parentId: number | null
}
type SolverSummary = {
  id: number
  name: string
  events: number
  attempts: number
  counts: Record<string, number>
}
type SearchTrace = {
  event: (type: string, data?: EventData) => void
  candidate: (value: Candidate) => CandidateRecord
  attempt: () => void
}

export function json(value: unknown): string {
  return JSON.stringify(value, (_key: string, item: unknown): unknown => {
    if (typeof item === "number" && !Number.isFinite(item)) return String(item)
    if (ArrayBuffer.isView(item))
      return Array.from(item as unknown as ArrayLike<number>)
    if (item instanceof Map) return Array.from(item.entries())
    if (item instanceof Set) return Array.from(item)
    return item
  })
}

export class SearchRecorder {
  private traces = new WeakMap<TinyHyperGraphSolver, SearchTrace>()
  private candidates = new WeakMap<Candidate, number>()
  private nextCandidateId = 0
  private sequence = 0
  private summaries: SolverSummary[] = []
  private currentShard = -1
  stage = "initialization"
  private outputDir: string | undefined
  private eventsFd: number | undefined
  private writeIndividualEvents = true
  private counts: Record<string, number> = {}
  private examples: Record<string, string> = {}
  private exampleSequences: Record<string, number> = {}

  start(outputDir: string, writeIndividualEvents = true): void {
    if (this.outputDir) throw new Error("A* recorder already started")
    mkdirSync(outputDir, { recursive: false })
    this.outputDir = outputDir
    this.writeIndividualEvents = writeIndividualEvents
    mkdirSync(path.join(outputDir, "solvers"))
    this.eventsFd = openSync(path.join(outputDir, "events.jsonl"), "wx")
    this.finish("recording")
  }

  attach(solver: TinyHyperGraphSolver): SearchTrace {
    const existing = this.traces.get(solver)
    if (existing) return existing
    if (!this.outputDir) throw new Error("A* recorder has not been started")
    const summary: SolverSummary = {
      id: this.summaries.length + 1,
      name: solver.constructor.name,
      events: 0,
      attempts: 0,
      counts: {},
    }
    this.summaries.push(summary)
    const solverDir = path.join(this.outputDir, "solvers", String(summary.id))
    mkdirSync(solverDir)
    writeFileSync(
      path.join(solverDir, "input.json"),
      json({
        solverId: summary.id,
        name: summary.name,
        stage: this.stage,
        topology: solver.topology,
        problem: solver.problem,
      }),
    )
    const candidate = (value: Candidate): CandidateRecord => {
      let id = this.candidates.get(value)
      if (id === undefined) {
        id = ++this.nextCandidateId
        this.candidates.set(value, id)
      }
      const parentId = value.prevCandidate
        ? this.candidates.get(value.prevCandidate)
        : null
      if (parentId === undefined)
        throw new Error("A* candidate parent was not recorded")
      const { prevCandidate: _parent, ...fields } = value
      return { id, parentId, ...fields }
    }
    // Capture route/attempt before callbacks can clear currentRouteId (goal contact).
    let routeId: number | undefined = solver.state.currentRouteId
    const event = (type: string, data: EventData = {}): void => {
      if (!this.outputDir) throw new Error("A* recorder has not been started")
      const sequence = ++this.sequence
      const shard = Math.floor((sequence - 1) / 1000)
      const shardName = String(shard).padStart(6, "0")
      if (this.writeIndividualEvents && shard !== this.currentShard) {
        mkdirSync(path.join(this.outputDir, "events", shardName), {
          recursive: true,
        })
        this.currentShard = shard
      }
      const record = {
        sequence,
        type,
        solverId: summary.id,
        stage: this.stage,
        iteration: solver.iterations,
        attempt: summary.attempts,
        routeId: routeId ?? null,
        queueLength: solver.state.candidateQueue.length,
        ...data,
      }
      const serialized = json(record)
      if (this.writeIndividualEvents) {
        writeFileSync(
          path.join(
            this.outputDir,
            "events",
            shardName,
            `${String(sequence).padStart(9, "0")}.json`,
          ),
          serialized + "\n",
        )
      }
      if (this.eventsFd === undefined) throw new Error("A* event log is closed")
      writeSync(this.eventsFd, serialized + "\n")
      this.examples[type] ??= this.writeIndividualEvents
        ? `events/${shardName}/${String(sequence).padStart(9, "0")}.json`
        : "events.jsonl"
      this.exampleSequences[type] ??= sequence
      summary.events++
      summary.counts[type] = (summary.counts[type] ?? 0) + 1
      this.counts[type] = (this.counts[type] ?? 0) + 1
    }
    const attempt = (): void => {
      routeId = solver.state.currentRouteId
      summary.attempts++
      writeFileSync(
        path.join(solverDir, `attempt-${summary.attempts}.json`),
        json({
          routeId,
          state: {
            portAssignment: solver.state.portAssignment,
            regionSegments: solver.state.regionSegments,
            regionCongestionCost: solver.state.regionCongestionCost,
            unroutedRoutes: solver.state.unroutedRoutes,
          },
        }),
      )
      event("attempt-start", {
        route:
          routeId === undefined
            ? null
            : solver.problem.routeMetadata?.[routeId],
      })
    }
    const queue = solver.state.candidateQueue
    const originalQueue = queue.queue.bind(queue)
    queue.queue = (value: Candidate): void => {
      const record = candidate(value)
      originalQueue(value)
      event("candidate", { candidate: record })
    }
    const originalClear = queue.clear.bind(queue)
    queue.clear = (): void => {
      event("frontier-clear", {
        discardedCandidateIds: queue
          .toArray()
          .map((value): number => candidate(value).id),
      })
      originalClear()
    }
    const originalPath = solver.onPathFound.bind(solver)
    solver.onPathFound = (value: Candidate): void => {
      event("path-proposed", {
        candidate: candidate(value),
        segments: solver.getSolvedPathSegments(value),
      })
      originalPath(value)
      event("path-result", {
        accepted: solver.state.currentRouteId === undefined,
        solved: solver.solved,
        failed: solver.failed,
      })
    }
    const trace: SearchTrace = { event, candidate, attempt }
    this.traces.set(solver, trace)
    event("solver-start")
    for (const value of queue.toArray())
      event("candidate", {
        candidate: candidate(value),
        existingAtAttach: true,
      })
    return trace
  }

  finish(status: string, details: EventData = {}): void {
    if (!this.outputDir) throw new Error("A* recorder has not been started")
    writeFileSync(
      path.join(this.outputDir, "manifest.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          status,
          eventCount: this.sequence,
          candidateCount: this.nextCandidateId,
          counts: this.counts,
          solvers: this.summaries,
          examples: this.examples,
          exampleSequences: this.exampleSequences,
          events: "events.jsonl",
          individualEvents: this.writeIndividualEvents
            ? "events/<floor((sequence-1)/1000), padded to 6>/<sequence, padded to 9>.json"
            : null,
          ...details,
        },
        null,
        2,
      ),
    )
    const lines: string[] = [
      "# Port point A* recording",
      "",
      `Status: ${status}. ${this.sequence} events; ${this.nextCandidateId} candidates; ${this.summaries.length} solver instances.`,
      "",
      "[Manifest and totals](manifest.json) · [All events, in order](events.jsonl) · [Run result](../result.json) · [Input board](../input.srj.json)",
      "",
      "## Example mini JSON files",
      "",
      ...Object.entries(this.examples).map(([type, file]): string =>
        this.writeIndividualEvents
          ? `- [${type}](${file}) — ${this.counts[type]} events`
          : `- ${type}: ${this.counts[type]} events (see events.jsonl)`,
      ),
      "",
      "## Solver inputs and attempt snapshots",
      "",
      ...this.summaries.flatMap((summary): string[] => [
        `- [Solver ${summary.id}: ${summary.name}](solvers/${summary.id}/input.json)`,
        ...Array.from(
          { length: summary.attempts },
          (_, index): string =>
            `  - [Attempt ${index + 1}](solvers/${summary.id}/attempt-${index + 1}.json)`,
        ),
      ]),
      "",
      "Candidate IDs are run-global; parentId points to the previous candidate. Port and region IDs resolve against each solver's input.json. A neighbor event describes one examined neighbor, including rejections. Goal contact can end expansion before the remaining neighbors are visited. Nonfinite costs use strings (Infinity, -Infinity, NaN).",
      "",
      "This records the pinned tiny-hypergraph A* loop used by Pipelines 7/9, including nested constructor-time searches and rerips. It does not instrument high-density routing or other algorithms. Recording performs synchronous disk I/O; its timing is unsuitable for benchmarks.",
    ]
    writeFileSync(
      path.join(this.outputDir, "README.md"),
      lines.join("\n") + "\n",
    )
    if (status !== "recording" && this.eventsFd !== undefined) {
      closeSync(this.eventsFd)
      this.eventsFd = undefined
    }
  }
}

export const recorder = new SearchRecorder()
