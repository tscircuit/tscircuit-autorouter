import { readdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { csv } from "./summarizeResults"

type FunctionKey = string
type CpuNode = {
  id: number
  callFrame: { functionName: string; url: string; lineNumber: number; columnNumber: number }
  children?: number[]
}
type CpuProfile = { nodes: CpuNode[]; samples: number[]; timeDeltas: number[]; startTime: number; endTime: number }
type CpuFunctionTiming = {
  function: string; file: string; line: number; column: number;
  selfMs: number; inclusiveMs: number; routingSelfMs: number; routingInclusiveMs: number;
  samples: number; routingSamples: number;
}

export async function summarizeCpuProfiles(outDir: string): Promise<void> {
  const cpuDir = resolve(outDir, "cpu")
  const optionsFile = Bun.file(resolve(cpuDir, "profile-options.json"))
  const profileOptions = await optionsFile.exists()
    ? await optionsFile.json() as Record<string, { intervalUs: number; smol: boolean }>
    : null
  const manifests = (await readdir(outDir)).filter((name) => name === "manifest-cpu.json" || name === "manifest-all.json").sort().reverse()
  const manifest = manifests.length ? await Bun.file(resolve(outDir, manifests[0]!)).json() as { cpuIntervalUs?: number; cpuSmol?: boolean } : null
  const functions = new Map<FunctionKey, CpuFunctionTiming>()
  const sampleRows: { sampleId: string; intervalUs: number; smol: boolean; samples: number; sampledMs: number; routingSampledMs: number; profileDurationMs: number }[] = []
  for (const sampleId of (await readdir(cpuDir)).filter((name) => /^sample\d{3}$/.test(name)).sort()) {
    const profiles = (await readdir(resolve(cpuDir, sampleId))).filter((name) => /\.cpuprofile(?:\.gz)?$/.test(name))
    if (profiles.length !== 1) throw new Error(`Expected exactly one native CPU profile for ${sampleId}, got ${profiles.length}`)
    const profileFile = Bun.file(resolve(cpuDir, sampleId, profiles[0]!))
    const profile = (profiles[0]!.endsWith(".gz")
      ? JSON.parse(new TextDecoder().decode(Bun.gunzipSync(await profileFile.arrayBuffer())))
      : await profileFile.json()) as CpuProfile
    if (profile.samples.length !== profile.timeDeltas.length) throw new Error(`Invalid CPU sample timing lengths: ${sampleId}`)
    const nodes = new Map(profile.nodes.map((node) => [node.id, node]))
    const parents = new Map<number, number>()
    for (const node of profile.nodes) for (const childId of node.children ?? []) parents.set(childId, node.id)
    let sampledMs = 0
    let routingSampledMs = 0
    for (let index = 0; index < profile.samples.length; index++) {
      const durationMs = profile.timeDeltas[index]! / 1000
      if (durationMs < 0) throw new Error(`Negative CPU sample interval: ${sampleId}`)
      sampledMs += durationMs
      let currentId: number | undefined = profile.samples[index]!
      const stack: CpuNode[] = []
      while (currentId !== undefined) {
        const node = nodes.get(currentId)
        if (!node) throw new Error(`Missing CPU frame ${currentId}`)
        stack.push(node)
        currentId = parents.get(currentId)
      }
      const routing = stack.some((node) => node.callFrame.functionName === "step" && node.callFrame.url.includes("BaseSolver"))
      if (routing) routingSampledMs += durationMs
      const visited = new Set<FunctionKey>()
      for (let depth = 0; depth < stack.length; depth++) {
        const frame = stack[depth]!.callFrame
        const file = frame.url.replace("file://", "").replace(`${process.cwd()}/`, "") || "[native]"
        const functionName = frame.functionName || "(anonymous)"
        const key = `${file}:${frame.lineNumber}:${frame.columnNumber}:${functionName}`
        if (visited.has(key)) continue
        visited.add(key)
        let timing = functions.get(key)
        if (!timing) {
          timing = { function: functionName, file, line: frame.lineNumber + 1, column: frame.columnNumber + 1,
            selfMs: 0, inclusiveMs: 0, routingSelfMs: 0, routingInclusiveMs: 0, samples: 0, routingSamples: 0 }
          functions.set(key, timing)
        }
        timing.inclusiveMs += durationMs
        if (routing) timing.routingInclusiveMs += durationMs
        if (depth === 0) {
          timing.selfMs += durationMs
          timing.samples++
          if (routing) { timing.routingSelfMs += durationMs; timing.routingSamples++ }
        }
      }
    }
    const options = profileOptions?.[sampleId] ?? profileOptions?.default
    sampleRows.push({ sampleId, intervalUs: options?.intervalUs ?? manifest?.cpuIntervalUs ?? 1000,
      smol: options?.smol ?? manifest?.cpuSmol ?? false,
      samples: profile.samples.length, sampledMs, routingSampledMs,
      profileDurationMs: (profile.endTime - profile.startTime) / 1000 })
  }
  const functionRows = [...functions.values()].sort((left, right) => right.routingSelfMs - left.routingSelfMs)
  await writeFile(resolve(outDir, "cpu-functions.csv"), csv(functionRows))
  await writeFile(resolve(outDir, "cpu-samples.csv"), csv(sampleRows))
  await writeFile(resolve(outDir, "cpu-summary.json"), JSON.stringify({ samples: sampleRows, functions: functionRows }))
  console.log(`Native CPU summary: ${sampleRows.length} samples, ${functionRows.length} functions`)
}
