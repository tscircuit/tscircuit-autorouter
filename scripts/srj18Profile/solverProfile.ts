type SolverId = number
type MethodKey = string
type Scalar = string | number | boolean | null
type SolverSnapshot = {
  id: SolverId
  parentId: SolverId | null
  solver: string
  stage: string
  nodeId: string | null
  snapshot: Record<string, unknown>
  winningSolverId: SolverId | null
  activeDepth: number
  inclusiveMs: number
}
type Span = {
  startMs: number
  childDurationMs: number
  solver: SolverSnapshot
  method: MethodTiming
  receiver: object
}
type MethodTiming = {
  solverId: SolverId
  owner: string
  method: string
  stage: string
  calls: number
  inclusiveMs: number
  selfMs: number
  maxCallMs: number
}

function getNodeId(receiver: object): string | null {
  for (const property of [
    "nodeWithPortPoints",
    "node",
    "activeNode",
    "originalNodeWithPortPoints",
  ]) {
    const node: unknown = Reflect.get(receiver, property)
    if (
      node &&
      typeof node === "object" &&
      "capacityMeshNodeId" in node &&
      typeof node.capacityMeshNodeId === "string"
    ) {
      return node.capacityMeshNodeId
    }
  }
  return null
}

function snapshotSolver(receiver: object): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {}
  for (const property of [
    "iterations",
    "MAX_ITERATIONS",
    "solved",
    "failed",
    "error",
    "progress",
    "cacheHit",
    "growthAttempts",
    "adaptiveSearchExpanded",
    "ripCount",
    "rips",
    "phase",
    "currentStage",
    "connectionName",
  ]) {
    const field: unknown = Reflect.get(receiver, property)
    if (
      field === null ||
      ["string", "number", "boolean"].includes(typeof field)
    )
      snapshot[property] = field
  }
  for (const property of ["hyperParameters", "stats"]) {
    const fields: unknown = Reflect.get(receiver, property)
    if (!fields || typeof fields !== "object") continue
    const scalars: Record<string, Scalar> = {}
    for (const [key, field] of Object.entries(fields)) {
      if (
        field === null ||
        typeof field === "string" ||
        typeof field === "number" ||
        typeof field === "boolean"
      )
        scalars[key] = field
    }
    snapshot[property] = scalars
  }
  return snapshot
}

export class SolverProfile {
  enabled = false
  stage = "pipeline_construction"
  private stack: Span[] = []
  private byReceiver = new WeakMap<object, SolverSnapshot>()
  private solvers: SolverSnapshot[] = []
  private methods = new Map<MethodKey, MethodTiming>()

  enter(
    receiver: object,
    label: { owner: string; method: string },
  ): Span | null {
    if (!this.enabled) return null
    const parent = this.stack.at(-1)
    let solver = this.byReceiver.get(receiver)
    if (!solver) {
      solver = {
        id: this.solvers.length + 1,
        parentId: parent?.solver.id ?? null,
        solver: receiver.constructor.name,
        stage: this.stage,
        nodeId: getNodeId(receiver) ?? parent?.solver.nodeId ?? null,
        snapshot: snapshotSolver(receiver),
        winningSolverId: null,
        activeDepth: 0,
        inclusiveMs: 0,
      }
      this.byReceiver.set(receiver, solver)
      this.solvers.push(solver)
    }
    const key = `${solver.id}/${this.stage}/${label.owner}/${label.method}`
    let method = this.methods.get(key)
    if (!method) {
      method = {
        solverId: solver.id,
        owner: label.owner,
        method: label.method,
        stage: this.stage,
        calls: 0,
        inclusiveMs: 0,
        selfMs: 0,
        maxCallMs: 0,
      }
      this.methods.set(key, method)
    }
    const span = {
      startMs: performance.now(),
      childDurationMs: 0,
      solver,
      method,
      receiver,
    }
    solver.activeDepth++
    this.stack.push(span)
    return span
  }

  exit(span: Span | null): void {
    if (!span) return
    const endMs = performance.now()
    if (this.stack.pop() !== span)
      throw new Error("Unbalanced synchronous solver profile stack")
    const durationMs = endMs - span.startMs
    if (--span.solver.activeDepth === 0) span.solver.inclusiveMs += durationMs
    span.method.calls++
    span.method.inclusiveMs += durationMs
    span.method.selfMs += durationMs - span.childDurationMs
    span.method.maxCallMs = Math.max(span.method.maxCallMs, durationMs)
    const receiver = span.receiver
    if (span.method.method === "step") {
      span.solver.snapshot.iterations = Reflect.get(receiver, "iterations")
      span.solver.snapshot.progress = Reflect.get(receiver, "progress")
      if (Reflect.get(receiver, "solved") || Reflect.get(receiver, "failed")) {
        span.solver.snapshot = snapshotSolver(receiver)
      }
      span.solver.winningSolverId =
        this.byReceiver.get(Reflect.get(receiver, "winningSolver") ?? {})?.id ??
        null
    }
    const parent = this.stack.at(-1)
    if (parent) parent.childDurationMs += durationMs
  }

  construct<T extends object>(factory: () => T, owner: string): T {
    if (!this.enabled) return factory()
    const placeholder = { constructor: { name: owner } }
    const span = this.enter(placeholder, { owner, method: "constructor" })
    try {
      const receiver = factory()
      if (!span) throw new Error("Missing constructor profile span")
      const existing = this.byReceiver.get(receiver)
      if (existing) {
        // Constructor-internal step/setup calls can register the receiver first.
        // Keep their IDs and link that record under the construction span.
        existing.parentId = span.solver.id
      } else {
        this.byReceiver.set(receiver, span.solver)
      }
      span.receiver = receiver
      span.solver.solver = receiver.constructor.name
      span.solver.nodeId = getNodeId(receiver) ?? span.solver.nodeId
      span.solver.snapshot = snapshotSolver(receiver)
      return receiver
    } finally {
      this.exit(span)
    }
  }

  export(): { solvers: Record<string, unknown>[]; methods: MethodTiming[] } {
    if (this.stack.length)
      throw new Error("Profile export attempted during an active span")
    const solvers = this.solvers.map(({ snapshot, activeDepth, ...solver }) => {
      let nodeId = solver.nodeId
      let parentId = solver.parentId
      while (!nodeId && parentId !== null) {
        const parent = this.solvers[parentId - 1]!
        nodeId = parent.nodeId
        parentId = parent.parentId
      }
      return { ...solver, nodeId, ...snapshot }
    })
    return { solvers, methods: [...this.methods.values()] }
  }
}

export const solverProfile = new SolverProfile()
