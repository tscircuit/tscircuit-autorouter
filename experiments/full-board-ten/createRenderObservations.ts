type EffectEvent = { phase: string; effectName: string }
type ObservedCircuit = {
  render: (...args: unknown[]) => unknown
  on: (name: "asyncEffect:start" | "asyncEffect:end", callback: (event: EffectEvent) => void) => void
}

/** Observes this benchmark circuit only; never subscribes to render lifecycle events. */
export function createRenderObservations(circuit: ObservedCircuit, started: number) {
  const cpuOrigin = process.cpuUsage()
  const effects: Record<string, { started: number; ended: number }> = {}
  const renders: { startedMs: number; wallMs: number; userCpuUs: number; systemCpuUs: number }[] = []
  const samples: ReturnType<typeof readResources>[] = []
  let calls = 0, outerCalls = 0, depth = 0, maximumDepth = 0
  let outerWallMs = 0, outerUserCpuUs = 0, outerSystemCpuUs = 0
  let activeOuterStart: number | undefined
  let activeOuterCpu: ReturnType<typeof process.cpuUsage> | undefined
  let lastSavedSampleMs = -Infinity
  const originalRender = circuit.render
  circuit.render = function (...args: unknown[]) {
    calls++
    depth++
    maximumDepth = Math.max(maximumDepth, depth)
    const outermost = depth === 1
    const before = performance.now()
    const beforeCpu = outermost ? process.cpuUsage() : undefined
    if (outermost) {
      activeOuterStart = before
      activeOuterCpu = beforeCpu
    }
    try {
      return originalRender.apply(this, args)
    } finally {
      depth--
      if (outermost) {
        const wallMs = performance.now() - before
        const cpu = process.cpuUsage(beforeCpu)
        outerCalls++
        outerWallMs += wallMs
        outerUserCpuUs += cpu.user
        outerSystemCpuUs += cpu.system
        activeOuterStart = undefined
        activeOuterCpu = undefined
        if (renders.length < 256) renders.push({ startedMs: before - started, wallMs, userCpuUs: cpu.user, systemCpuUs: cpu.system })
      }
    }
  }
  circuit.on("asyncEffect:start", ({ phase, effectName }) => {
    const key = `${phase}/${effectName}`
    effects[key] ??= { started: 0, ended: 0 }
    effects[key].started++
  })
  circuit.on("asyncEffect:end", ({ phase, effectName }) => {
    const key = `${phase}/${effectName}`
    effects[key] ??= { started: 0, ended: 0 }
    effects[key].ended++
  })
  function readResources(label: string) {
    const now = performance.now()
    const absoluteCpu = process.cpuUsage()
    const cpu = { user: absoluteCpu.user - cpuOrigin.user, system: absoluteCpu.system - cpuOrigin.system }
    const memory = process.memoryUsage()
    const usage = process.resourceUsage()
    const activeCpu = activeOuterCpu ? { user: absoluteCpu.user - activeOuterCpu.user, system: absoluteCpu.system - activeOuterCpu.system } : { user: 0, system: 0 }
    const activeWall = activeOuterStart === undefined ? 0 : now - activeOuterStart
    return {
      label, elapsedMs: now - started,
      userCpuUs: cpu.user, systemCpuUs: cpu.system,
      rssBytes: memory.rss, heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal, externalBytes: memory.external,
      minorPageFaults: usage.minorPageFault ?? null, majorPageFaults: usage.majorPageFault ?? null,
      voluntaryContextSwitches: usage.voluntaryContextSwitches ?? null,
      involuntaryContextSwitches: usage.involuntaryContextSwitches ?? null,
      renderCalls: calls, outerRenderCalls: outerCalls,
      activeRenderDepth: depth,
      outerRenderWallMs: outerWallMs + activeWall, outerRenderUserCpuUs: outerUserCpuUs + activeCpu.user,
      outerRenderSystemCpuUs: outerSystemCpuUs + activeCpu.system,
    }
  }
  function capture(label: string, force = false) {
    const resource = readResources(label)
    const persist = force || resource.elapsedMs - lastSavedSampleMs >= 15000
    if (persist) {
      samples.push(resource)
      lastSavedSampleMs = resource.elapsedMs
    }
    return { resource, persist }
  }
  function snapshot() {
    return {
      instrumentation: "Identical benchmark-only circuit.render wrapper, effect counters and process resource samples; original receiver/arguments/return/throw preserved. No production files changed.",
      renderCostScope: "Synchronous render-call intervals include any routing work started synchronously inside render; these are not isolated Core overhead measurements.",
      renderLifecycleListenersAdded: false, forcedGc: false,
      gcPauseMeasurementAvailable: false,
      gcLimit: "Bun exposes no stable observational GC pause counter here; heap sizes and CPU are recorded without claiming GC attribution.",
      calls, outerCalls, maximumDepth, outerWallMs, outerUserCpuUs, outerSystemCpuUs,
      renderSamplesTruncated: outerCalls > renders.length, effects, renders, samples,
    }
  }
  return { capture, snapshot }
}
