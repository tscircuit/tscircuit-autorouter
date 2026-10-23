import type { SamplingProfile } from "bun:jsc"

type FunctionSamples = {
  source: string
  name: string
  self: number
  inclusive: number
}

/** Diagnostic sampling only: inclusive counts deduplicate recursive frames. */
export function summarizeBenchmarkCpuProfile(profile: SamplingProfile): {
  sampleCount: number
  intervalSeconds: number
  self: FunctionSamples[]
  inclusive: FunctionSamples[]
  functions: string
  bytecodes: string
} {
  const functions = new Map<string, FunctionSamples>()
  const sources = new Map(profile.stackTraces.sources.map(source => [source.sourceID, source.url]))
  for (const trace of profile.stackTraces.traces) {
    const seen = new Set<string>()
    for (let index = 0; index < trace.frames.length; index++) {
      const frame = trace.frames[index]!
      const source = frame.sourceURL ?? sources.get(frame.sourceID) ?? "native-or-unknown"
      const key = JSON.stringify([source, frame.name])
      let counts = functions.get(key)
      if (!counts) {
        counts = { source, name: frame.name, self: 0, inclusive: 0 }
        functions.set(key, counts)
      }
      if (index === 0) counts.self++
      if (!seen.has(key)) {
        counts.inclusive++
        seen.add(key)
      }
    }
  }
  const values = Array.from(functions.values())
  return {
    sampleCount: profile.stackTraces.traces.length,
    intervalSeconds: profile.stackTraces.interval,
    self: values.toSorted((left, right) => right.self - left.self).slice(0, 100),
    inclusive: values.toSorted((left, right) => right.inclusive - left.inclusive).slice(0, 100),
    functions: profile.functions,
    bytecodes: profile.bytecodes,
  }
}
