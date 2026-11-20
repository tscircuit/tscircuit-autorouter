import { plugin } from "bun"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// Analysis-only observer. It reads original routing decisions and never changes
// candidate order, input geometry, solver limits or a clearance return value.
type Rejection = {
  plan: { connectionName: string; busId: string; sourcePoint: unknown; segments: unknown[] }
  segment?: unknown
  via?: unknown
  obstacle?: unknown
  otherPlan?: unknown
  clearance?: number
}
const counters = new Map<string, { connection: string; bus: string; reason: string; count: number }>()
const examples = new Map<string, unknown>()
const transformedModules: { path: string; originalSha256: string; sites: string[] }[] = []
const operations = new Map<string, { calls: number; seconds: number; maximumExpandedStates: number }>()
const progress = new WeakMap<object, { operation: string; at: number; attempts: number; best: number }>()
const attemptHistory: unknown[] = []
let outputDirectory: string | undefined
let overheadMs = 0

;(globalThis as any).__e2eFanoutRejection = (reason: string, rejection: Rejection): void => {
  const started = performance.now()
  const connection = rejection.plan.connectionName
  const bus = rejection.plan.busId
  const key = `${connection}|${reason}`
  const counter = counters.get(key) ?? { connection, bus, reason, count: 0 }
  counter.count++
  counters.set(key, counter)
  if (!examples.has(key)) examples.set(key, structuredClone(rejection))
  overheadMs += performance.now() - started
}

function replaceUnique(source: string, marker: string, replacement: string): string {
  if (source.split(marker).length !== 2) throw new Error(`Instrumentation marker is not unique: ${marker.slice(0, 80)}`)
  return source.replace(marker, replacement)
}

plugin({
  name: "observe-original-fanout-clearance-decisions",
  setup(build) {
    build.onLoad({ filter: /[\/]route-bus[\/]plan-(static|mutual)-clearance\.ts$/ }, async ({ path }) => {
      const original = await Bun.file(path).text()
      let source = original
      const sites: string[] = []
      if (path.endsWith("plan-static-clearance.ts")) {
        const split = source.indexOf("export interface StaticPlanSegmentCache")
        if (split < 0) throw new Error("Static clearance function boundary missing")
        const head = source.slice(0, split)
        const tail = source.slice(split)
        source = replaceUnique(head, "    return false", '    ;(globalThis as any).__e2eFanoutRejection("pad-trace", { plan, segment, obstacle, clearance })\n    return false') + tail
        sites.push("foreign-obstacle-trace-rejection")
        source = replaceUnique(source, "  ) {\n    return false\n  }\n  const segments = getPlanSegments(plan)", '  ) {\n    ;(globalThis as any).__e2eFanoutRejection("outside-boundary", { plan, clearance })\n    return false\n  }\n  const segments = getPlanSegments(plan)')
        sites.push("outside-routing-boundary")
        source = replaceUnique(source, "        return false\n      }\n    }\n    if (hasPlaneCopper", '        ;(globalThis as any).__e2eFanoutRejection("pad-via", { plan, via, obstacle, clearance })\n        return false\n      }\n    }\n    if (hasPlaneCopper')
        sites.push("foreign-obstacle-via-rejection")
        source = replaceUnique(source, "    if (hasPlaneCopper && !touchesPlaneCopper) return false", '    if (hasPlaneCopper && !touchesPlaneCopper) {\n      ;(globalThis as any).__e2eFanoutRejection("missing-plane-contact", { plan, via, clearance })\n      return false\n    }')
        sites.push("missing-plane-contact")
      } else {
        source = replaceUnique(source, "    const recordBlocker = (): void => {", '    const recordBlocker = (): void => {\n      ;(globalThis as any).__e2eFanoutRejection("accepted-plan-copper", { plan, otherPlan, clearance })')
        sites.push("existing-plan-copper-rejection")
      }
      transformedModules.push({ path, originalSha256: new Bun.CryptoHasher("sha256").update(original).digest("hex"), sites })
      return { contents: source, loader: "ts" }
    })
  },
})

export function activateInterception(directory: string): void {
  outputDirectory = directory
  mkdirSync(directory, { recursive: true })
}

export function observeFanoutProgress(solver: any): void {
  const now = performance.now()
  const stats = solver.stats ?? {}
  const operation = `${stats.phase ?? "setup"}/${stats.routingStrategy ?? "default"}`
  let previous = progress.get(solver)
  if (!previous) {
    previous = { operation, at: now, attempts: 0, best: -1 }
    progress.set(solver, previous)
  }
  const entry = operations.get(previous.operation) ?? { calls: 0, seconds: 0, maximumExpandedStates: 0 }
  entry.calls++
  entry.seconds += (now - previous.at) / 1000
  entry.maximumExpandedStates = Math.max(entry.maximumExpandedStates, Number(stats.expandedStates ?? 0))
  operations.set(previous.operation, entry)
  previous.operation = operation
  previous.at = now
  const attempts = solver.attempts ?? []
  if (attempts.length !== previous.attempts) {
    for (const attempt of attempts.slice(previous.attempts)) attemptHistory.push(structuredClone(attempt))
    previous.attempts = attempts.length
  }
  const routed = solver.bestAttempt?.summary?.routedConnectionCount ?? -1
  if (routed !== previous.best) {
    previous.best = routed
    console.log("FANOUT_BEST", routed, "of", solver.inputSrj.connections.length, "after", attempts.length, "assignments")
  }
}

export function saveInternalInterception(): void {
  if (!outputDirectory) return
  const summary = {
    transformedModules,
    observerCallbackMs: overheadMs,
    operations: Object.fromEntries(operations),
    rejections: [...counters.values()].sort((a, b) => b.count - a.count),
    completedAssignments: attemptHistory,
    interpretation: "Rejection counts are attempted candidate checks, not failed nets. Examples retain the original rejection geometry. Routing predicates are unchanged.",
  }
  writeFileSync(join(outputDirectory, "pipeline-internals.json"), JSON.stringify(summary, null, 2))
  writeFileSync(join(outputDirectory, "fanout-rejection-examples.json.gz"), Bun.gzipSync(JSON.stringify([...examples.entries()])))
}
