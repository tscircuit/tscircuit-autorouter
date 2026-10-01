import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { Resvg } from "@resvg/resvg-js"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import {
  measurePostRoutingMetrics,
  type PostRoutingMetrics,
} from "lib/solvers/PostRoutingOptimization/measurePostRoutingMetrics"
import type { PostRoutingOptimizationOptions } from "lib/solvers/PostRoutingOptimization/optimizePostRouting"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

export type RealBoardArm = "baseline" | "A" | "B" | "A+B"
export type RealBoardRun = {
  arm: RealBoardArm
  solved: boolean
  failed: boolean
  error: string | null
  phase: string
  availableCopper:
    | "complete"
    | "last-accepted"
    | "before-failed-phase"
    | "partial"
    | "none"
  traces: SimplifiedPcbTraces
  srjWithPointPairs: SimpleRouteJson | null
  metrics: PostRoutingMetrics
  nativeErrors: string[] | null
  wallMilliseconds: number
  outputSha256: string
  selectedConnection: string
  phaseSearchBudget: { maxExpansions: number; maxMilliseconds: number }
}
export type RealBoardComparison = {
  input: SimpleRouteJson
  runs: RealBoardRun[]
  svg: string
  pngPath: string
}

/** Snapshot evidence retains failures; this never accepts or repairs a route. */
function captureRun(input: SimpleRouteJson, arm: RealBoardArm): RealBoardRun {
  const selected = input.connections.find((c) => c.pointsToConnect.length >= 2)
  if (!selected)
    throw new Error("Real-board control requires a routed connection")
  const passCount = arm === "A+B" ? 2 : 1
  const phase: PostRoutingOptimizationOptions = {
    enabled: true,
    nets: [{ net: selected.name, maxNewVias: 2, maxNewViasPerBranch: 1 }],
    objective: {
      priorities: ["viaSites", "copperLength", "bends"],
      maxCopperLengthIncrease: 0,
      maxBendIncrease: 0,
      maxChangedNets: 1,
    },
    search: {
      gridStep: 0.5,
      viaCost: 3,
      bendCost: 0.05,
      maxExpansions: 300_000 / passCount,
      maxMilliseconds: 5_000 / passCount,
    },
  }
  const opts = {
    effort: 0.1,
    cacheProvider: null,
    ...(arm.includes("A") ? { dynamicNetTreeRouting: phase } : {}),
    ...(arm.includes("B") ? { postRoutingOptimization: phase } : {}),
  }
  const random = Math.random
  let state = 1
  Math.random = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0
    return state / 2 ** 32
  }
  let solver: Pipeline9
  let error: string | null = null
  const started = performance.now()
  try {
    solver = new Pipeline9(structuredClone(input), opts)
    // A bounded routing-work slot, independent of Bun's test timeout. An
    // unfinished solve remains unfinished and is asserted below the snapshots.
    while (
      !solver.solved &&
      !solver.failed &&
      performance.now() - started < 25_000
    )
      solver.step()
    if (!solver.solved && !solver.failed)
      error = "25-second real-board routing work budget exhausted"
  } catch (caught) {
    error = String(caught)
    if (!solver!) throw caught
  } finally {
    Math.random = random
  }
  const wallMilliseconds = performance.now() - started
  let traces: SimplifiedPcbTraces = []
  let availableCopper: RealBoardRun["availableCopper"] = "none"
  if (solver.solved) {
    traces = solver.getOutputSimpleRouteJson().traces ?? []
    availableCopper = "complete"
  } else if (solver.getPostRoutingOptimizationResult()?.status === "accepted") {
    traces = solver.getPostRoutingOptimizationResult()!.traces
    availableCopper = "last-accepted"
  } else if (solver.powerTraceExpansionSolver?.solved) {
    const fixed = (
      solver.powerTraceExpansionSolver.inputSrj as SimpleRouteJson & {
        fixedTraces: SimplifiedPcbTraces
      }
    ).fixedTraces
    traces = [...fixed, ...solver.powerTraceExpansionSolver.getOutput()]
    availableCopper = "before-failed-phase"
  } else if (solver.highDensityRouteSolver?.solved) {
    traces = [
      ...solver.getUpdatedPreloadedTraces(),
      ...solver.getNewTracesBeforePowerExpansion(),
    ]
    availableCopper = "partial"
  }
  const paired = solver.srjWithPointPairs ?? null
  const errors =
    paired && availableCopper !== "none"
      ? evaluateRelaxedDrc({
          inputSrj: input,
          srjWithPointPairs: paired,
          routedTraces: traces,
        }).errors.map((e) => JSON.stringify(e))
      : null
  const owners = new Map(
    input.connections.map((c) => [c.name, c.__netConnectionName ?? c.name]),
  )
  for (const trace of traces)
    if (!owners.has(trace.connection_name))
      owners.set(trace.connection_name, trace.connection_name)
  return {
    arm,
    solved: solver.solved,
    failed: solver.failed,
    error: error ?? solver.error,
    phase: solver.getCurrentPhase(),
    availableCopper,
    traces: structuredClone(traces),
    srjWithPointPairs: paired,
    metrics: measurePostRoutingMetrics(traces, owners),
    nativeErrors: errors,
    wallMilliseconds,
    selectedConnection: selected.name,
    phaseSearchBudget: {
      maxExpansions: phase.search.maxExpansions,
      maxMilliseconds: phase.search.maxMilliseconds,
    },
    outputSha256: createHash("sha256")
      .update(JSON.stringify(traces))
      .digest("hex"),
  }
}

function escapeSvg(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/** Same physical viewport, dimensions, layer colors and legend in every panel. */
function renderComparison(
  input: SimpleRouteJson,
  runs: RealBoardRun[],
): string {
  const xs = [input.bounds.minX, input.bounds.maxX],
    ys = [input.bounds.minY, input.bounds.maxY]
  for (const run of runs)
    for (const trace of run.traces)
      for (const p of trace.route) {
        if ("x" in p) {
          xs.push(p.x)
          ys.push(p.y)
        } else if ("start" in p && "end" in p) {
          xs.push(p.start.x, p.end.x)
          ys.push(p.start.y, p.end.y)
        }
      }
  const bounds = {
    minX: Math.min(...xs) - 5,
    maxX: Math.max(...xs) + 5,
    minY: Math.min(...ys) - 5,
    maxY: Math.max(...ys) + 5,
  }
  const panelWidth = 700,
    boardHeight = 560,
    headerHeight = 110
  const panels = runs.map((run, index) => {
    let board: string
    if (run.srjWithPointPairs && run.availableCopper !== "none") {
      board = getBugReportSnapshotSvg(
        {
          inputSrj: input,
          srjWithPointPairs: run.srjWithPointPairs,
          routedTraces: run.traces,
        },
        { bounds, svgWidth: panelWidth, svgHeight: boardHeight },
      )
    } else {
      const graphics = convertSrjToGraphicsObject({
        ...input,
        traces: run.traces,
      })
      graphics.points = []
      graphics.rects.push({
        center: {
          x: (bounds.minX + bounds.maxX) / 2,
          y: (bounds.minY + bounds.maxY) / 2,
        },
        width: bounds.maxX - bounds.minX,
        height: bounds.maxY - bounds.minY,
        stroke: "transparent",
        fill: "transparent",
      })
      board = getSvgFromGraphicsObject(graphics, {
        backgroundColor: "white",
        svgWidth: panelWidth,
        svgHeight: boardHeight,
      })
    }
    board = board.replace(
      /<svg\b/,
      `<svg x="${index * panelWidth}" y="${headerHeight}"`,
    )
    const label = `${run.arm}: ${run.solved ? "solved" : "FAILED / NOT ACCEPTED"}; ${run.availableCopper} copper`
    const metrics = `${run.metrics.viaSites} vias; ${run.metrics.copperLength.toFixed(3)} mm; ${run.metrics.bends} bends; native errors ${run.nativeErrors?.length ?? "unavailable"}`
    const detail = run.error ?? "Routing completed with original rules"
    const lines = [detail.slice(0, 110), detail.slice(110, 220)]
    return `<text x="${index * panelWidth + 16}" y="28" font-size="18" font-weight="bold">${escapeSvg(label)}</text><text x="${index * panelWidth + 16}" y="52" font-size="15">${escapeSvg(metrics)}</text>${lines.map((line, i) => `<text x="${index * panelWidth + 16}" y="${76 + i * 16}" font-size="11" fill="#9f1239">${escapeSvg(line)}</text>`).join("")}${board}`
  })
  const metadata = input as SimpleRouteJson & {
    sourceName?: string
    id?: string
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${panelWidth * runs.length}" height="${boardHeight + headerHeight + 35}" viewBox="0 0 ${panelWidth * runs.length} ${boardHeight + headerHeight + 35}"><rect width="100%" height="100%" fill="white"/><g font-family="Arial, sans-serif">${panels.join("")}<text x="16" y="${headerHeight + boardHeight + 24}" font-size="14">SRJ18 ${escapeSvg(String(metadata.sourceName ?? metadata.id ?? "public board"))} | identical physical scale | top red, bottom blue/dashed; pads retain native geometry</text></g></svg>`
}

export async function runPipeline9RealBoardComparison(
  sample: number,
  arms: RealBoardArm[],
  testPath: string,
): Promise<RealBoardComparison> {
  const { scenario } = await loadScenarioBySampleNumber("srj18", sample)
  const input = structuredClone(scenario),
    original = JSON.stringify(input)
  const runs = arms.map((arm) => captureRun(input, arm))
  if (JSON.stringify(input) !== original)
    throw new Error("Real-board original fixture was mutated")
  const svg = renderComparison(input, runs)
  const snapshotDir = path.join(path.dirname(testPath), "__snapshots__")
  await mkdir(snapshotDir, { recursive: true })
  const pngPath = path.join(
    snapshotDir,
    path.basename(testPath).replace(/\.test\.ts$/, "-before-after.snap.png"),
  )
  // Expected SVGs use the native matcher; this matching PNG is a reviewable
  // image in GitHub's Files changed view, including runs that fail afterwards.
  await writeFile(
    pngPath,
    new Uint8Array(new Resvg(svg, { background: "white" }).render().asPng()),
  )
  console.log(
    "REAL_BOARD_COMPARISON " +
      JSON.stringify({
        dataset: "srj18",
        sample,
        seed: 1,
        effort: 0.1,
        extraSearchExpansions: 300_000,
        extraSearchMilliseconds: 5_000,
        routerWorkMillisecondsPerArm: 25_000,
        runs: runs.map(({ traces, srjWithPointPairs, ...report }) => report),
      }),
  )
  return { input, runs, svg, pngPath }
}
