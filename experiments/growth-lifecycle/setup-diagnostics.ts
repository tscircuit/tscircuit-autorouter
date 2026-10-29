type SetupRecord = { id: number; family: string; actualConstructor: string; setupInvocationCount: number; setup: Record<string, any>; stepCallCount: number; lastIterations: number; lastMaxIterations: number; lastSolved: boolean; lastFailed: boolean }

function snapshot(solver: any): Record<string, any> {
  const buffers = new Set<ArrayBufferLike>()
  const seen = new Set<object>()
  const typedArrays: Record<string, number> = {}
  const arrays: Record<string, number> = {}
  let visitedObjects = 0
  let truncated = false
  const visit = (value: object, prefix: string, depth: number): void => {
    if (seen.has(value)) return
    seen.add(value)
    if (++visitedObjects > 64) { truncated = true; return }
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!("value" in descriptor)) continue
      const item = descriptor.value
      const name = prefix ? `${prefix}.${key}` : key
      if (ArrayBuffer.isView(item)) {
        typedArrays[name] = item.byteLength
        buffers.add(item.buffer)
      } else if (Array.isArray(item)) {
        arrays[name] = item.length
      } else if (item && typeof item === "object" && depth < 2 && !(item instanceof Map) && !(item instanceof Set) && key !== "nodeWithPortPoints") {
        visit(item, name, depth + 1)
      }
    }
  }
  visit(solver, "", 0)
  return {
    iterations: solver.iterations,
    maxIterations: solver.MAX_ITERATIONS,
    baseSearchBudgetIters: solver.baseSearchBudgetIters,
    setupDone: solver._setupDone,
    solved: solver.solved,
    failed: solver.failed,
    nodeWidth: solver.nodeWithPortPoints?.width,
    nodeHeight: solver.nodeWithPortPoints?.height,
    nodeId: solver.nodeWithPortPoints?.capacityMeshNodeId,
    rows: solver.rows,
    cols: solver.cols,
    layers: solver.layers,
    planeSize: solver.planeSize,
    connectionSegments: solver.unsolvedSegs?.length,
    neighborCsrOffsets: solver.neighborOffset?.length ?? null,
    neighborCsrEdges: solver.neighborIds?.length ?? null,
    typedArrays,
    arrays,
    uniqueWorkspaceBufferBytes: [...buffers].reduce((total, buffer) => total + buffer.byteLength, 0),
    workspaceTraversalTruncated: truncated,
  }
}

export function installSetupLifecycleObservers(hd: Record<string, any>): () => { details: Record<string, any>[]; families: Record<string, any> } {
  const records: SetupRecord[] = []
  const byInstance = new WeakMap<object, number>()
  for (const family of ["HighDensitySolverA01", "HighDensitySolverA03"]) {
    const cls = hd[family]
    if (typeof cls !== "function" || typeof cls.prototype.setup !== "function" || typeof cls.prototype.step !== "function") throw new Error(`Missing official lifecycle contract for ${family}`)
    const originalSetup = cls.prototype.setup
    const originalStep = cls.prototype.step
    Object.defineProperty(cls.prototype, "setup", { configurable: true, writable: true, value: function (this: any, ...args: unknown[]): unknown {
      const wasSetup = this._setupDone === true
      const result = originalSetup.apply(this, args)
      let index = byInstance.get(this)
      if (index === undefined && !wasSetup) {
        index = records.length
        records.push({ id: index, family, actualConstructor: this.constructor.name, setupInvocationCount: 0, setup: snapshot(this), stepCallCount: 0, lastIterations: this.iterations, lastMaxIterations: this.MAX_ITERATIONS, lastSolved: this.solved, lastFailed: this.failed })
        byInstance.set(this, index)
      }
      if (index !== undefined) records[index]!.setupInvocationCount++
      return result
    } })
    Object.defineProperty(cls.prototype, "step", { configurable: true, writable: true, value: function (this: any, ...args: unknown[]): unknown {
      const result = originalStep.apply(this, args)
      const index = byInstance.get(this)
      if (index !== undefined) {
        const record = records[index]!
        record.stepCallCount++
        record.lastIterations = this.iterations
        record.lastMaxIterations = this.MAX_ITERATIONS
        record.lastSolved = this.solved
        record.lastFailed = this.failed
      }
      return result
    } })
  }
  return (): { details: Record<string, any>[]; families: Record<string, any> } => {
    if (records.length === 0) throw new Error("No official A01/A03 setup instances were observed")
    const details = records.map(record => ({ ...record, noObservedStepCallsAfterSetup: record.stepCallCount === 0, setupAlreadyTerminal: record.setup.solved === true || record.setup.failed === true }))
    const families = Object.fromEntries(["HighDensitySolverA01", "HighDensitySolverA03"].map(family => {
      const group = details.filter(record => record.family === family)
      const noSteps = group.filter(record => record.noObservedStepCallsAfterSetup)
      const eligibleNoSteps = noSteps.filter(record => !record.setupAlreadyTerminal)
      return [family, {
        uniqueSetupInstances: group.length,
        setupInvocations: group.reduce((total, record) => total + record.setupInvocationCount, 0),
        stepCalls: group.reduce((total, record) => total + record.stepCallCount, 0),
        noObservedStepCallsAfterSetup: noSteps.length,
        alreadySolvedAtSetupWithoutStepCalls: noSteps.filter(record => record.setup.solved === true).length,
        failedAtSetupWithoutStepCalls: noSteps.filter(record => record.setup.failed === true).length,
        nonterminalSetupWithoutObservedStepCalls: eligibleNoSteps.length,
        sumSetupWorkspaceBufferBytes: group.reduce((total, record) => total + record.setup.uniqueWorkspaceBufferBytes, 0),
        sumSetupWorkspaceBufferBytesForNonterminalNoStepInstances: eligibleNoSteps.reduce((total, record) => total + record.setup.uniqueWorkspaceBufferBytes, 0),
        sumNeighborCsrEdgesForNonterminalNoStepInstances: eligibleNoSteps.reduce((total, record) => total + (record.setup.neighborCsrEdges ?? 0), 0),
        maxSetupWorkspaceBufferBytes: group.reduce((largest, record) => Math.max(largest, record.setup.uniqueWorkspaceBufferBytes), 0),
        largestNonterminalNoStepInstances: [...eligibleNoSteps].sort((a, b) => b.setup.uniqueWorkspaceBufferBytes - a.setup.uniqueWorkspaceBufferBytes).slice(0, 16),
      }]
    }))
    return { details, families }
  }
}
