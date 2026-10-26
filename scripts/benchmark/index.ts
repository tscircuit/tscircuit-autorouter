#!/usr/bin/env bun
import {
  averageTraceLintIssues,
  formatTraceLintTable,
} from "./trace-lint-metrics.js"

import {
  type ChildProcessWithoutNullStreams,
  spawn,
  spawnSync,
} from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { appendFile, readFile, writeFile } from "node:fs/promises"
import * as path from "node:path"
import * as readline from "node:readline"
import { gzipSync } from "node:zlib"
import type { SimpleRouteJson } from "../../lib/types/srj-types"
import type {
  BenchmarkReport,
  BenchmarkSnapshot,
  BenchmarkSnapshotWithImage,
  BenchmarkTask,
  FailureSummary,
  SolverRunSummary,
  WorkerChildMessage,
  WorkerProgress,
  WorkerResult,
  WorkerResultWithImage,
  WorkerTaskMessage,
} from "./benchmark-types"
import { extendPartialBenchmarkStageTiming } from "./benchmark-stage-timing"
import {
  getBenchmarkConcurrency,
  getBenchmarkThreadConcurrency,
  getBenchmarkRuntimeMetadata,
} from "./benchmarkRuntime"
import {
  DATASET_OPTIONS_LABEL,
  type DatasetName,
  loadScenarios,
  parseDatasetName,
} from "./scenarios"
import { AUTOROUTER_VERSION } from "../../lib"
import {
  planLocalHighDensityClusterResources,
  readLocalCpuTopology,
} from "./localHighDensityClusterResources"
import {
  startLocalHighDensityCluster,
  type LocalHighDensityCluster,
  type LocalHighDensityClusterStats,
} from "./startLocalHighDensityCluster"
import { countDeterministicNetworkedValidationRejections } from "./countDeterministicNetworkedValidationRejections"

type BenchmarkOptions = {
  solverName?: string
  captureFinalSrj?: boolean
  networkedColdHot: boolean
  networkedRemote: boolean
  concurrencyWasSet: boolean
  scenarioLimit?: number
  sampleNumbers?: number[]
  concurrency: number
  threads?: number
  effort?: number
  sampleTimeoutMs?: number
  excludeAssignable: boolean
  datasetName: DatasetName
}

type WorkerTaskAssignment = {
  request: WorkerTaskMessage
  startedAtMs: number
  timeout: ReturnType<typeof setTimeout>
  latestProgress?: WorkerProgress
}

type WorkerSlot = {
  id: number
  child: ChildProcessWithoutNullStreams
  stdoutReader: readline.Interface
  stderrReader: readline.Interface
  currentTask: WorkerTaskAssignment | null
  cpuIds?: number[]
}

type WorkerExecutionResult = {
  result: WorkerResultWithImage
  restartWorker: boolean
}

type BenchmarkSnapshotWriter = {
  writeSnapshot: (snapshot: BenchmarkSnapshotWithImage) => Promise<void>
  finish: () => Promise<void>
}

type RunBenchmarkTasksOptions = {
  onBenchmarkSnapshot?: (snapshot: BenchmarkSnapshotWithImage) => Promise<void>
  cpuLanes?: number[][]
  signal?: AbortSignal
}

type NetworkedColdHotValidationOptions = {
  allowValidationRejections?: boolean
}

const DEFAULT_TASK_TIMEOUT_BASE_MS = 300 * 1000
const DEFAULT_TASK_TIMEOUT_PER_EFFORT_MS = 60 * 1000
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30 * 1000
const DEFAULT_TERMINATE_TIMEOUT_MS = 5 * 1000
const DEFAULT_BENCHMARK_SOLVER_NAME =
  "AutoroutingPipelineSolver9_PreloadedTraceGraph"
const NETWORKED_PIPELINE9_SOLVER_NAME = "AutoroutingPipelineSolver9_Networked"
const NETWORKED_PIPELINE9_COLD_NAME = "Pipeline9_Networked Cold"
const NETWORKED_PIPELINE9_HOT_NAME = "Pipeline9_Networked Hot"
export const DEFAULT_NETWORKED_CACHE_PROPAGATION_DELAY_MS = 65_000
const BENCHMARK_SNAPSHOTS_HTML_PATH = "benchmark-snapshots.html"

export const logCapturedFinalSrjs = (
  results: WorkerResult[],
  writeLine: (line: string) => void = console.log,
): void => {
  for (const [captureIndex, result] of results.entries()) {
    if (!result.finalSrj) continue
    const raw = Buffer.from(JSON.stringify(result.finalSrj), "utf8")
    const compressed = gzipSync(raw)
    const base64 = compressed.toString("base64")
    const chunkSize = 4000
    const chunkCount = Math.ceil(base64.length / chunkSize)
    const sha256 = createHash("sha256").update(raw).digest("hex")
    writeLine(
      `BENCHMARK_FINAL_SRJ_BEGIN ${JSON.stringify({
        version: 1,
        captureIndex,
        datasetName: result.benchmarkSnapshot?.datasetName,
        solverName: result.solverName,
        scenarioName: result.scenarioName,
        sampleNumber: result.sampleNumber,
        encoding: "gzip+base64",
        rawBytes: raw.length,
        gzipBytes: compressed.length,
        chunkCount,
        sha256,
      })}`,
    )
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      writeLine(
        `BENCHMARK_FINAL_SRJ_CHUNK ${captureIndex} ${chunkIndex + 1}/${chunkCount} ${base64.slice(chunkIndex * chunkSize, (chunkIndex + 1) * chunkSize)}`,
      )
    }
    writeLine(
      `BENCHMARK_FINAL_SRJ_END ${JSON.stringify({ captureIndex, sha256 })}`,
    )
  }
}

export const logCapturedPathingDiagnostics = (
  results: WorkerResult[],
  writeLine: (line: string) => void = console.log,
): void => {
  for (const [captureIndex, result] of results.entries()) {
    if (!result.pathingDiagnostics) continue
    const { benchmarkSnapshot, finalSrj, ...summary } = result
    const raw = Buffer.from(JSON.stringify(summary), "utf8")
    const compressed = gzipSync(raw)
    const base64 = compressed.toString("base64")
    const chunkSize = 4000
    const chunkCount = Math.ceil(base64.length / chunkSize)
    const sha256 = createHash("sha256").update(raw).digest("hex")
    writeLine(
      `BENCHMARK_PATHING_DIAGNOSTICS_BEGIN ${JSON.stringify({
        version: 1,
        captureIndex,
        datasetName: result.pathingDiagnostics.datasetName,
        solverName: result.solverName,
        scenarioName: result.scenarioName,
        sampleNumber: result.sampleNumber,
        encoding: "gzip+base64",
        rawBytes: raw.length,
        gzipBytes: compressed.length,
        chunkCount,
        sha256,
      })}`,
    )
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      writeLine(
        `BENCHMARK_PATHING_DIAGNOSTICS_CHUNK ${captureIndex} ${chunkIndex + 1}/${chunkCount} ${base64.slice(chunkIndex * chunkSize, (chunkIndex + 1) * chunkSize)}`,
      )
    }
    writeLine(
      `BENCHMARK_PATHING_DIAGNOSTICS_END ${JSON.stringify({ captureIndex, sha256 })}`,
    )
  }
}

export const parseNetworkedCachePropagationDelayMs = (
  rawValue: string | undefined = process.env
    .BENCHMARK_NETWORKED_CACHE_PROPAGATION_DELAY_MS,
): number => {
  if (rawValue === undefined || rawValue.trim() === "") {
    return DEFAULT_NETWORKED_CACHE_PROPAGATION_DELAY_MS
  }
  const delayMs = Number(rawValue)
  if (!Number.isSafeInteger(delayMs) || delayMs < 0) {
    throw new Error(
      "BENCHMARK_NETWORKED_CACHE_PROPAGATION_DELAY_MS must be a non-negative integer",
    )
  }
  return delayMs
}

const formatTime = (timeMs: number | null) => {
  if (timeMs === null) {
    return "n/a"
  }
  return `${(timeMs / 1000).toFixed(1)}s`
}

const formatMemory = (byteCount: number | null | undefined) => {
  if (byteCount === null || byteCount === undefined) {
    return "n/a"
  }
  const mebibytes = byteCount / (1024 * 1024)
  return `${mebibytes.toFixed(1)} MiB`
}

const formatAverage = (value: number | null) => {
  if (value === null) {
    return "n/a"
  }
  return value.toFixed(2)
}

const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

export const sanitizeBenchmarkSnapshotSvg = (imageSvg: string): string => {
  let sanitizedSvg = imageSvg.replace(/<script\b[\s\S]*?<\/script>/gi, "")
  // Keep the generated root background in the same user-space coordinates as
  // the circuit so changing the root viewBox pans and zooms them together.
  const openingSvgTag = sanitizedSvg.match(/<svg\b[^>]*>/i)?.[0]
  const viewBoxValues = openingSvgTag
    ?.match(/\bviewBox=["']([^"']+)["']/i)?.[1]
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
  const svgContentsStart = openingSvgTag
    ? sanitizedSvg.indexOf(openingSvgTag) + openingSvgTag.length
    : -1
  const rootBackgroundMatch =
    svgContentsStart >= 0
      ? sanitizedSvg.slice(svgContentsStart).match(/^(\s*)(<rect\b[^>]*\/?>)/i)
      : null

  if (
    viewBoxValues?.length === 4 &&
    viewBoxValues.every(Number.isFinite) &&
    rootBackgroundMatch &&
    /\bwidth=["']100%["']/i.test(rootBackgroundMatch[2]) &&
    /\bheight=["']100%["']/i.test(rootBackgroundMatch[2])
  ) {
    const [x, y, width, height] = viewBoxValues
    const backgroundRectWithViewBoxBounds = rootBackgroundMatch[2]
      .replace(/\s+(?:x|y)=["'][^"']*["']/gi, "")
      .replace(/\bwidth=["']100%["']/i, `x="${x}" y="${y}" width="${width}"`)
      .replace(/\bheight=["']100%["']/i, `height="${height}"`)
    const backgroundStart = svgContentsStart + rootBackgroundMatch[1].length
    sanitizedSvg =
      sanitizedSvg.slice(0, backgroundStart) +
      backgroundRectWithViewBoxBounds +
      sanitizedSvg.slice(backgroundStart + rootBackgroundMatch[2].length)
  }
  sanitizedSvg = sanitizedSvg.replace(
    /<g\b[^>]*\bid=["']crosshair["'][\s\S]*?<\/g>/gi,
    "",
  )
  sanitizedSvg = sanitizedSvg.replace(
    /<g\b[^>]*>\s*<circle\b(?=[^>]*\bdata-type=["']point["'])[^>]*(?:\/>|>\s*<\/circle>)\s*<\/g>/gi,
    "",
  )
  sanitizedSvg = sanitizedSvg.replace(
    /<text\b(?=[^>]*\bdata-label=["']Cursor["'])[\s\S]*?<\/text>/gi,
    "",
  )
  return sanitizedSvg
}

export const createSnapshotCardHtml = (
  snapshot: BenchmarkSnapshotWithImage,
  snapshotIndex: number,
): string => {
  const snapshotLabel = escapeHtml(snapshot.label)
  const snapshotDescriptionId = `snapshot-${snapshotIndex}-description`
  const sanitizedImageSvg = sanitizeBenchmarkSnapshotSvg(snapshot.imageSvg)

  return `<section class="snapshot">
  <h2>${snapshotLabel}</h2>
  <dl>
    <div><dt>Dataset</dt><dd>${escapeHtml(snapshot.datasetName)}</dd></div>
    <div><dt>Solver</dt><dd>${escapeHtml(snapshot.solverName)}</dd></div>
    <div><dt>Sample</dt><dd>${escapeHtml(snapshot.sampleNumber)}</dd></div>
    <div><dt>Scenario</dt><dd>${escapeHtml(snapshot.scenarioName)}</dd></div>
    <div><dt>Time</dt><dd>${escapeHtml(formatTime(snapshot.elapsedTimeMs))}</dd></div>
    <div><dt>Trace Count</dt><dd>${escapeHtml(snapshot.traceCount)}</dd></div>
    <div><dt>Via</dt><dd>${escapeHtml(snapshot.viaCount)}</dd></div>
    <div><dt>DRC Issue Count</dt><dd>${escapeHtml(snapshot.drcErrorCount ?? "n/a")}</dd></div>
    <div><dt>Relaxed DRC</dt><dd>${snapshot.relaxedDrcPassed ? "passed" : "failed"}</dd></div>
  </dl>
  <div class="snapshot-viewer" data-snapshot-viewer>
    <div class="viewer-toolbar" role="toolbar" aria-label="Snapshot View Controls">
      <p class="viewer-hint">Scroll to zoom. Zoom, then drag to pan.</p>
      <button type="button" data-viewer-action="reset" aria-label="Reset View">Reset</button>
      <button type="button" data-viewer-action="fullscreen" aria-label="Enter Fullscreen" aria-pressed="false">Enter Fullscreen</button>
    </div>
    <div id="${snapshotDescriptionId}" class="sr-only">Scroll or use the plus and minus keys to zoom. After zooming, drag or use arrow keys to pan ${snapshotLabel}.</div>
    <div class="snapshot-image" data-viewer-viewport tabindex="0" role="img" aria-label="${snapshotLabel}" aria-describedby="${snapshotDescriptionId}">${sanitizedImageSvg}</div>
  </div>
</section>`
}

const BENCHMARK_SNAPSHOTS_HTML_START = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Benchmark Snapshots</title>
  <style>
    :root { color-scheme: light; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #171717; background: #f5f5f4; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 32px; overflow-x: hidden; }
    button { font: inherit; }
    .skip-link { position: fixed; left: 16px; top: 16px; z-index: 20; transform: translateY(-64px); border: 1px solid #a3a3a3; border-radius: 6px; background: #fff; color: #171717; padding: 8px 12px; text-decoration: none; box-shadow: 0 8px 24px rgb(0 0 0 / 12%); }
    .skip-link:focus-visible { transform: translateY(0); outline: 3px solid #525252; outline-offset: 2px; }
    main { max-width: 1160px; margin: 0 auto; }
    h1 { margin: 0 0 8px; font-size: 28px; line-height: 1.2; text-wrap: balance; }
    p { margin: 0 0 24px; color: #525252; }
    .snapshot, .empty { margin: 24px 0; padding: 20px; border: 1px solid #d4d4d4; border-radius: 8px; background: #fbfbfa; box-shadow: 0 1px 2px rgb(0 0 0 / 5%); }
    .snapshot { content-visibility: auto; contain-intrinsic-size: 860px; }
    h2 { margin: 0 0 14px; font-size: 18px; line-height: 1.3; text-wrap: balance; overflow-wrap: anywhere; }
    dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px 16px; margin: 0 0 18px; }
    dl div { min-width: 0; }
    dt { font-size: 12px; color: #737373; }
    dd { margin: 2px 0 0; font-size: 14px; overflow-wrap: anywhere; }
    .snapshot-viewer { border: 1px solid #d4d4d4; border-radius: 8px; background: #f5f5f4; overflow: hidden; }
    .viewer-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: flex-end; min-height: 48px; padding: 8px; border-bottom: 1px solid #e5e5e5; background: #fafaf9; }
    .viewer-hint { margin: 0 auto 0 0; color: #525252; font-size: 13px; }
    .viewer-toolbar button { min-height: 32px; border: 1px solid #a3a3a3; border-radius: 6px; background: #fff; color: #171717; padding: 5px 10px; cursor: pointer; touch-action: manipulation; }
    .viewer-toolbar button:hover { background: #f5f5f5; border-color: #737373; }
    .viewer-toolbar button:active { background: #e5e5e5; }
    .viewer-toolbar button:focus-visible, .snapshot-image:focus-visible { outline: 3px solid #525252; outline-offset: 2px; }
    .snapshot-image { display: grid; place-items: start; width: 100%; min-height: 320px; max-height: 72vh; aspect-ratio: 1 / 1; overflow: hidden; background: #fbfbfa; cursor: grab; touch-action: pan-y pinch-zoom; user-select: none; -webkit-tap-highlight-color: transparent; }
    .snapshot-image.is-zoomed { touch-action: none; }
    .snapshot-image.is-panning { cursor: grabbing; }
    .snapshot-image svg { display: block; width: 100%; height: 100%; }
    body.has-full-size-viewer { overflow: hidden; }
    .snapshot.has-full-size-viewer { content-visibility: visible; contain: none; }
    .snapshot-viewer.is-full-size { position: fixed; inset: 0; z-index: 100; display: flex; flex-direction: column; width: 100vw; height: 100vh; height: 100dvh; border: 0; border-radius: 0; padding: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left)); background: #f5f5f4; }
    .snapshot-viewer.is-full-size .viewer-toolbar { flex: 0 0 auto; border: 1px solid #d4d4d4; border-radius: 8px 8px 0 0; }
    .snapshot-viewer.is-full-size .snapshot-image { flex: 1 1 auto; min-height: 0; max-height: none; aspect-ratio: auto; border: 1px solid #d4d4d4; border-top: 0; border-radius: 0 0 8px 8px; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
    @media (max-width: 720px) {
      body { padding: 16px; }
      .snapshot, .empty { padding: 14px; }
      .viewer-toolbar { justify-content: flex-start; }
      .viewer-hint { flex-basis: 100%; }
      .snapshot-image { min-height: 260px; }
    }
  </style>
</head>
<body>
  <a class="skip-link" href="#benchmark-snapshots-main">Skip To Snapshots</a>
  <main id="benchmark-snapshots-main">
    <h1>Benchmark Snapshots</h1>
    <p>Final routed-output graphics from every solved benchmark sample. Images are embedded as inline SVG for crisp offline viewing at any zoom.</p>
`

const BENCHMARK_SNAPSHOTS_HTML_END = `  </main>
  <script>
    (() => {
      const minScale = 1
      const maxScale = 20

      const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

      const getButton = (viewer, action) =>
        viewer.querySelector('[data-viewer-action="' + action + '"]')

      const updateFullSizeButton = (viewer, isFullSize) => {
        const button = getButton(viewer, "fullscreen")
        if (!button) return
        button.textContent = isFullSize ? "Exit Fullscreen" : "Enter Fullscreen"
        button.setAttribute(
          "aria-label",
          isFullSize ? "Exit Fullscreen" : "Enter Fullscreen",
        )
        button.setAttribute("aria-pressed", String(isFullSize))
      }

      const setViewerFullSize = (viewer, isFullSize) => {
        const currentViewer = document.querySelector(
          "[data-snapshot-viewer].is-full-size",
        )
        if (isFullSize && currentViewer && currentViewer !== viewer) {
          currentViewer.classList.remove("is-full-size")
          currentViewer
            .closest(".snapshot")
            ?.classList.remove("has-full-size-viewer")
          updateFullSizeButton(currentViewer, false)
        }
        viewer.classList.toggle("is-full-size", isFullSize)
        viewer
          .closest(".snapshot")
          ?.classList.toggle("has-full-size-viewer", isFullSize)
        document.body.classList.toggle("has-full-size-viewer", isFullSize)
        updateFullSizeButton(viewer, isFullSize)
      }

      const applyView = (state) => {
        const boundedScale = clamp(state.scale, minScale, maxScale)
        state.scale = boundedScale
        if (boundedScale === minScale) {
          state.viewBox = { ...state.baseViewBox }
        }
        state.viewport.classList.toggle("is-zoomed", boundedScale > minScale)
        state.svg.setAttribute(
          "viewBox",
          [
            state.viewBox.x,
            state.viewBox.y,
            state.viewBox.width,
            state.viewBox.height,
          ].join(" "),
        )
      }

      const zoomAt = (state, clientX, clientY, nextScale) => {
        const matrix = state.svg.getScreenCTM()
        if (!matrix) return
        const screenPoint = state.svg.createSVGPoint()
        screenPoint.x = clientX
        screenPoint.y = clientY
        const point = screenPoint.matrixTransform(matrix.inverse())
        const ratioX = (point.x - state.viewBox.x) / state.viewBox.width
        const ratioY = (point.y - state.viewBox.y) / state.viewBox.height
        const scale = clamp(nextScale, minScale, maxScale)
        const width = state.baseViewBox.width / scale
        const height = state.baseViewBox.height / scale
        state.viewBox = {
          x: point.x - ratioX * width,
          y: point.y - ratioY * height,
          width,
          height,
        }
        state.scale = scale
        applyView(state)
      }

      const zoomFromCenter = (state, multiplier) => {
        const rect = state.viewport.getBoundingClientRect()
        zoomAt(
          state,
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
          state.scale * multiplier,
        )
      }

      const resetView = (state) => {
        state.scale = 1
        state.viewBox = { ...state.baseViewBox }
        applyView(state)
      }

      const getScreenScale = (svg) => {
        const matrix = svg.getScreenCTM()
        if (!matrix) return { x: 1, y: 1 }
        return {
          x: Math.hypot(matrix.a, matrix.b),
          y: Math.hypot(matrix.c, matrix.d),
        }
      }

      const getPointerDistance = (pointers) => {
        const first = pointers[0]
        const second = pointers[1]
        const deltaX = first.clientX - second.clientX
        const deltaY = first.clientY - second.clientY
        return Math.hypot(deltaX, deltaY)
      }

      const getPointerCenter = (pointers) => {
        const first = pointers[0]
        const second = pointers[1]
        return {
          clientX: (first.clientX + second.clientX) / 2,
          clientY: (first.clientY + second.clientY) / 2,
        }
      }

      const initViewer = (viewer) => {
        const viewport = viewer.querySelector("[data-viewer-viewport]")
        const svg = viewport?.querySelector("svg")
        if (!viewport || !svg) return

        const svgViewBox = svg.viewBox.baseVal
        if (svgViewBox.width <= 0 || svgViewBox.height <= 0) return
        const baseViewBox = {
          x: svgViewBox.x,
          y: svgViewBox.y,
          width: svgViewBox.width,
          height: svgViewBox.height,
        }

        svg.querySelector("#crosshair")?.remove()
        svg.querySelectorAll("script").forEach((script) => script.remove())

        const state = {
          viewer,
          viewport,
          svg,
          baseViewBox,
          viewBox: { ...baseViewBox },
          scale: 1,
          pointers: new Map(),
          dragStart: null,
          pinchStart: null,
        }

        const fullscreenButton = getButton(viewer, "fullscreen")

        getButton(viewer, "reset")?.addEventListener("click", () => {
          resetView(state)
        })
        fullscreenButton?.addEventListener("click", () => {
          setViewerFullSize(viewer, !viewer.classList.contains("is-full-size"))
        })

        viewport.addEventListener(
          "wheel",
          (event) => {
            if (state.scale === minScale && !event.ctrlKey && event.deltaY > 0) {
              return
            }
            event.preventDefault()
            const multiplier = Math.exp(-event.deltaY * 0.001)
            zoomAt(state, event.clientX, event.clientY, state.scale * multiplier)
          },
          { passive: false },
        )

        viewport.addEventListener("keydown", (event) => {
          const panStep = event.shiftKey ? 80 : 32
          if (event.key === "+" || event.key === "=") {
            event.preventDefault()
            zoomFromCenter(state, 1.25)
          }
          if (event.key === "-" || event.key === "_") {
            event.preventDefault()
            zoomFromCenter(state, 0.8)
          }
          if (event.key === "0") {
            event.preventDefault()
            resetView(state)
          }
          if (state.scale > minScale && event.key === "ArrowLeft") {
            event.preventDefault()
            state.viewBox.x -= panStep / getScreenScale(svg).x
            applyView(state)
          }
          if (state.scale > minScale && event.key === "ArrowRight") {
            event.preventDefault()
            state.viewBox.x += panStep / getScreenScale(svg).x
            applyView(state)
          }
          if (state.scale > minScale && event.key === "ArrowUp") {
            event.preventDefault()
            state.viewBox.y -= panStep / getScreenScale(svg).y
            applyView(state)
          }
          if (state.scale > minScale && event.key === "ArrowDown") {
            event.preventDefault()
            state.viewBox.y += panStep / getScreenScale(svg).y
            applyView(state)
          }
        })

        viewport.addEventListener("pointerdown", (event) => {
          state.pointers.set(event.pointerId, event)
          viewport.setPointerCapture?.(event.pointerId)
          if (state.pointers.size === 1 && state.scale > minScale) {
            state.dragStart = {
              clientX: event.clientX,
              clientY: event.clientY,
              viewBoxX: state.viewBox.x,
              viewBoxY: state.viewBox.y,
              screenScale: getScreenScale(svg),
            }
            viewport.classList.add("is-panning")
          }
          if (state.pointers.size === 2) {
            const pointers = [...state.pointers.values()]
            state.pinchStart = {
              distance: getPointerDistance(pointers),
              scale: state.scale,
            }
          }
        })

        viewport.addEventListener("pointermove", (event) => {
          if (!state.pointers.has(event.pointerId)) return
          state.pointers.set(event.pointerId, event)
          if (state.pointers.size === 2 && state.pinchStart) {
            const pointers = [...state.pointers.values()]
            const center = getPointerCenter(pointers)
            const distance = getPointerDistance(pointers)
            zoomAt(
              state,
              center.clientX,
              center.clientY,
              state.pinchStart.scale * (distance / state.pinchStart.distance),
            )
            return
          }
          if (state.dragStart && state.scale > minScale) {
            state.viewBox.x =
              state.dragStart.viewBoxX -
              (event.clientX - state.dragStart.clientX) /
                state.dragStart.screenScale.x
            state.viewBox.y =
              state.dragStart.viewBoxY -
              (event.clientY - state.dragStart.clientY) /
                state.dragStart.screenScale.y
            applyView(state)
          }
        })

        const finishPointer = (event) => {
          state.pointers.delete(event.pointerId)
          if (state.pointers.size < 2) {
            state.pinchStart = null
            state.dragStart = null
            if (state.pointers.size === 1 && state.scale > minScale) {
              const pointer = [...state.pointers.values()][0]
              state.dragStart = {
                clientX: pointer.clientX,
                clientY: pointer.clientY,
                viewBoxX: state.viewBox.x,
                viewBoxY: state.viewBox.y,
                screenScale: getScreenScale(svg),
              }
            }
          }
          if (state.pointers.size === 0) {
            state.dragStart = null
            viewport.classList.remove("is-panning")
          }
        }

        viewport.addEventListener("pointerup", finishPointer)
        viewport.addEventListener("pointercancel", finishPointer)
        viewport.addEventListener("lostpointercapture", finishPointer)
        applyView(state)
      }

      document.querySelectorAll("[data-snapshot-viewer]").forEach(initViewer)
      document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return
        const viewer = document.querySelector(
          "[data-snapshot-viewer].is-full-size",
        )
        if (viewer) setViewerFullSize(viewer, false)
      })
    })()
  </script>
</body>
</html>
`

export const createBenchmarkSnapshotWriter = async (
  htmlPath: string,
): Promise<BenchmarkSnapshotWriter> => {
  let snapshotCount = 0
  let pendingWrite = Promise.resolve()

  await writeFile(htmlPath, BENCHMARK_SNAPSHOTS_HTML_START)

  return {
    writeSnapshot: async (snapshot) => {
      snapshotCount += 1
      const snapshotIndex = snapshotCount
      pendingWrite = pendingWrite.then(() =>
        appendFile(
          htmlPath,
          `${createSnapshotCardHtml(snapshot, snapshotIndex)}\n`,
        ),
      )
      await pendingWrite
    },
    finish: async () => {
      const htmlParts: string[] = []
      if (snapshotCount === 0) {
        htmlParts.push(
          `    <section class="empty"><p>No solved benchmark snapshots were produced for this run.</p></section>`,
        )
      }
      htmlParts.push(BENCHMARK_SNAPSHOTS_HTML_END)
      pendingWrite = pendingWrite.then(() =>
        appendFile(htmlPath, `${htmlParts.join("\n")}\n`),
      )
      await pendingWrite
    },
  }
}

const formatDurationLabel = (timeMs: number) => {
  if (timeMs < 1000) {
    return `${timeMs}ms`
  }
  return formatTime(timeMs)
}

const getTaskTimeoutPerEffortMs = () => {
  const rawTimeout =
    Bun.env.BENCHMARK_TASK_TIMEOUT_PER_EFFORT_MS?.trim() ??
    Bun.env.BENCHMARK_TASK_TIMEOUT_MS?.trim()
  if (!rawTimeout) {
    return DEFAULT_TASK_TIMEOUT_PER_EFFORT_MS
  }

  const parsedTimeout = Number.parseInt(rawTimeout, 10)
  if (!Number.isFinite(parsedTimeout) || parsedTimeout < 1) {
    throw new Error(
      "BENCHMARK_TASK_TIMEOUT_PER_EFFORT_MS must be a positive integer",
    )
  }

  return parsedTimeout
}

const getHeartbeatIntervalMs = () => {
  const rawInterval = Bun.env.BENCHMARK_HEARTBEAT_INTERVAL_MS?.trim()
  if (!rawInterval) {
    return DEFAULT_HEARTBEAT_INTERVAL_MS
  }

  const parsedInterval = Number.parseInt(rawInterval, 10)
  if (!Number.isFinite(parsedInterval) || parsedInterval < 0) {
    throw new Error(
      "BENCHMARK_HEARTBEAT_INTERVAL_MS must be a non-negative integer",
    )
  }

  return parsedInterval
}

const getTerminateTimeoutMs = () => {
  const rawTimeout = Bun.env.BENCHMARK_TERMINATE_TIMEOUT_MS?.trim()
  if (!rawTimeout) {
    return DEFAULT_TERMINATE_TIMEOUT_MS
  }

  const parsedTimeout = Number.parseInt(rawTimeout, 10)
  if (!Number.isFinite(parsedTimeout) || parsedTimeout < 1) {
    throw new Error("BENCHMARK_TERMINATE_TIMEOUT_MS must be a positive integer")
  }

  return parsedTimeout
}

const getPercentile = (
  measurements: number[],
  percentile: number,
): number | null => {
  if (measurements.length === 0) {
    return null
  }

  const sorted = [...measurements].sort((a, b) => a - b)
  const index = (sorted.length - 1) * percentile
  const lower = Math.floor(index)
  const upper = Math.ceil(index)

  if (lower === upper) {
    return sorted[lower]
  }

  const weight = index - lower
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight
}

const parseDurationArg = (rawValue: string, flagName: string) => {
  const value = rawValue.trim()
  const match = value.match(/^(\d+)(ms|s|m)?$/)
  if (!match) {
    throw new Error(
      `${flagName} must be an integer with optional ms, s, or m suffix`,
    )
  }

  const amount = Number.parseInt(match[1], 10)
  const unit = match[2] ?? "ms"
  const multiplier = unit === "m" ? 60_000 : unit === "s" ? 1_000 : 1

  return amount * multiplier
}

const parseSampleNumbersArg = (rawValue: string) => {
  const sampleNumbers = rawValue
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))

  if (
    sampleNumbers.length === 0 ||
    sampleNumbers.some(
      (sampleNumber) => !Number.isFinite(sampleNumber) || sampleNumber < 1,
    )
  ) {
    throw new Error(
      "--sample-numbers must be comma-separated positive integers",
    )
  }

  return sampleNumbers
}

export const parseArgs = (
  args: string[] = process.argv.slice(2),
): BenchmarkOptions => {
  const defaultConcurrency = getBenchmarkConcurrency()
  const options: BenchmarkOptions = {
    concurrency: defaultConcurrency,
    excludeAssignable: false,
    datasetName: "dataset01",
    networkedColdHot: false,
    networkedRemote: false,
    concurrencyWasSet: false,
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === "--solver") {
      options.solverName = args[i + 1]
      i += 1
      continue
    }
    if (arg === "--capture-final-srj") {
      options.captureFinalSrj = true
      continue
    }
    if (arg === "--networked-cold-hot") {
      options.networkedColdHot = true
      continue
    }
    if (arg === "--networked-remote") {
      options.networkedRemote = true
      continue
    }
    if (arg === "--scenario-limit") {
      options.scenarioLimit = Number.parseInt(args[i + 1], 10)
      i += 1
      continue
    }
    if (arg === "--concurrency") {
      const rawConcurrency = args[i + 1]
      options.concurrencyWasSet = rawConcurrency !== "auto"
      options.concurrency =
        rawConcurrency === "auto" ? defaultConcurrency : Number(rawConcurrency)
      i += 1
      continue
    }
    if (arg === "--threads") {
      options.threads = Number(args[i + 1])
      i += 1
      continue
    }
    if (arg === "--effort") {
      options.effort = Number(args[i + 1] ?? "")
      i += 1
      continue
    }
    if (arg === "--sample-timeout") {
      options.sampleTimeoutMs = parseDurationArg(
        args[i + 1] ?? "",
        "--sample-timeout",
      )
      i += 1
      continue
    }
    if (arg === "--sample-numbers") {
      options.sampleNumbers = parseSampleNumbersArg(args[i + 1] ?? "")
      i += 1
      continue
    }
    if (arg === "--exclude-assignable") {
      options.excludeAssignable = true
      continue
    }
    if (arg === "--dataset") {
      const rawDatasetName = args[i + 1]
      if (!rawDatasetName || rawDatasetName.startsWith("-")) {
        throw new Error(`--dataset requires a value (${DATASET_OPTIONS_LABEL})`)
      }
      const datasetName = parseDatasetName(rawDatasetName)
      if (!datasetName) {
        throw new Error(
          `Unknown dataset "${rawDatasetName}". Available: ${DATASET_OPTIONS_LABEL}`,
        )
      }
      options.datasetName = datasetName
      i += 1
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  if (options.solverName === NETWORKED_PIPELINE9_SOLVER_NAME) {
    options.networkedColdHot = true
    if (!args.includes("--dataset")) options.datasetName = "srj18"
  } else if (options.networkedRemote) {
    throw new Error("--networked-remote requires Pipeline9_Networked")
  }

  if (!Number.isSafeInteger(options.concurrency) || options.concurrency < 1) {
    throw new Error("--concurrency must be a positive integer")
  }

  if (options.threads !== undefined) {
    getBenchmarkThreadConcurrency(options.concurrency, options.threads)
    if (
      options.threads > 1 &&
      options.solverName !== undefined &&
      options.solverName !== "AutoroutingPipelineSolver9_PreloadedTraceGraph"
    ) {
      throw new Error("--threads > 1 requires Pipeline9_PreloadedTraceGraph")
    }
  }

  if (
    options.scenarioLimit !== undefined &&
    (!Number.isFinite(options.scenarioLimit) || options.scenarioLimit < 1)
  ) {
    throw new Error("--scenario-limit must be a positive integer")
  }

  if (
    options.effort !== undefined &&
    (!Number.isFinite(options.effort) || options.effort < 1)
  ) {
    throw new Error(
      "--effort must be a finite number greater than or equal to 1",
    )
  }

  return options
}

const loadSolverNames = async (
  excludeAssignable: boolean,
): Promise<string[]> => {
  // Use autorouter-pipelines/index.ts as the source of truth for benchmarkable solvers
  const pipelinesIndexPath = path.join(
    process.cwd(),
    "lib",
    "autorouter-pipelines",
    "index.ts",
  )
  const pipelinesIndex = await readFile(pipelinesIndexPath, "utf8")

  const pipelineNames = new Set<string>()
  for (const match of pipelinesIndex.matchAll(
    /export\s*\{([\s\S]*?)\}\s*from/g,
  )) {
    const exportEntries = match[1]
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)

    for (const entry of exportEntries) {
      const localName = entry.split(/\s+as\s+/)[0]?.trim()
      if (localName) {
        pipelineNames.add(localName)
      }
    }
  }

  // Resolve aliases from lib/index.ts (e.g. "X as Y")
  const libIndexPath = path.join(process.cwd(), "lib", "index.ts")
  const libIndex = await readFile(libIndexPath, "utf8")

  const solverNames = [...pipelineNames].flatMap((name) => {
    const aliasMatches = [
      ...libIndex.matchAll(new RegExp(`${name}\\s+as\\s+(\\w+)`, "g")),
    ].map((match) => match[1])

    return [name, ...aliasMatches]
  })
  const uniqueSolverNames = [...new Set(solverNames)]
  if (!uniqueSolverNames.includes("KrtAutoroutingPipelineSolver")) {
    uniqueSolverNames.push("KrtAutoroutingPipelineSolver")
  }

  if (!excludeAssignable) {
    return uniqueSolverNames
  }

  return uniqueSolverNames.filter((name) => !name.includes("Assignable"))
}

const formatTable = (rows: SolverRunSummary[]) => {
  const includeNetworkCache = rows.some((row) => row.networkCache)
  const headers = [
    "Solver",
    "Completed %",
    "Relaxed DRC Pass %",
    "Timed Out",
    "P50 Time",
    "P60 Time",
    "P70 Time",
    "P80 Time",
    "P90 Time",
    "P95 Time",
    "Memory P50",
    "Memory P80",
    "Memory P90",
    "Avg Via",
    ...(includeNetworkCache
      ? ["HD Cache Hits", "HD Solver Results", "HD Local Fallbacks"]
      : []),
  ]

  const body = rows.map((row) => [
    row.solverName,
    row.completedRateLabel,
    row.relaxedDrcRateLabel,
    row.timedOutLabel,
    formatTime(row.p50TimeMs),
    formatTime(row.p60TimeMs ?? null),
    formatTime(row.p70TimeMs ?? null),
    formatTime(row.p80TimeMs ?? null),
    formatTime(row.p90TimeMs ?? null),
    formatTime(row.p95TimeMs),
    formatMemory(row.p50PeakRssBytes),
    formatMemory(row.p80PeakRssBytes),
    formatMemory(row.p90PeakRssBytes),
    formatAverage(row.avgVia),
    ...(includeNetworkCache
      ? [
          `${row.networkCache?.cacheHits ?? 0}/${row.networkCache?.remoteRequests ?? 0}`,
          String(row.networkCache?.solverResults ?? 0),
          String(row.networkCache?.localFallbacks ?? 0),
        ]
      : []),
  ])

  const widths = headers.map((header, columnIndex) => {
    const maxBodyWidth = Math.max(
      ...body.map((cells) => cells[columnIndex].length),
      0,
    )
    return Math.max(header.length, maxBodyWidth)
  })

  const separator = `+${widths.map((width) => "-".repeat(width + 2)).join("+")}+`
  const headerLine = `| ${headers.map((header, i) => header.padEnd(widths[i])).join(" | ")} |`
  const bodyLines = body.map(
    (cells) =>
      `| ${cells.map((cell, i) => cell.padEnd(widths[i])).join(" | ")} |`,
  )

  return [separator, headerLine, separator, ...bodyLines, separator].join("\n")
}

const formatSampleNumbers = (sampleNumbers: number[]) => {
  const shown = sampleNumbers.slice(0, 8).join(", ")
  return sampleNumbers.length > 8 ? `${shown}, ...` : shown
}

const getFailureKeyForResult = (result: WorkerResult) => {
  if (result.didTimeout) {
    return {
      failureKind: "timeout at last observed phase",
      failureKeys: [
        [
          result.errorPhaseName ?? "unknown phase",
          result.errorSolverName ?? "unknown solver",
        ].join(" / "),
      ],
    }
  }

  if (!result.didSolve) {
    return {
      failureKind: "solver failure",
      failureKeys: [
        [
          result.errorPhaseName ?? "unknown phase",
          result.errorSolverName ?? "unknown solver",
          result.error ?? "unknown error",
        ].join(" / "),
      ],
    }
  }

  if (!result.relaxedDrcPassed) {
    const drcErrorTypes = result.drcErrorTypes ?? {}
    const failureKeys = Object.keys(drcErrorTypes)
    return {
      failureKind: "relaxed DRC",
      failureKeys: failureKeys.length > 0 ? failureKeys : ["unknown DRC error"],
    }
  }

  return null
}

const summarizeFailures = (results: WorkerResult[]): FailureSummary[] => {
  const buckets = new Map<
    string,
    {
      failureKind: string
      failureKey: string
      occurrences: number
      sampleNumbers: Set<number>
    }
  >()

  for (const result of results) {
    const failure = getFailureKeyForResult(result)
    if (!failure) {
      continue
    }

    for (const failureKey of failure.failureKeys) {
      const bucketKey = `${failure.failureKind}\0${failureKey}`
      const bucket = buckets.get(bucketKey) ?? {
        failureKind: failure.failureKind,
        failureKey,
        occurrences: 0,
        sampleNumbers: new Set<number>(),
      }
      bucket.sampleNumbers.add(result.sampleNumber)
      bucket.occurrences +=
        failure.failureKind === "relaxed DRC"
          ? (result.drcErrorTypes?.[failureKey] ?? 1)
          : 1
      buckets.set(bucketKey, bucket)
    }
  }

  return [...buckets.values()]
    .map((bucket) => ({
      failureKind: bucket.failureKind,
      failureKey: bucket.failureKey,
      affectedSamples: bucket.sampleNumbers.size,
      occurrences: bucket.occurrences,
      sampleNumbers: [...bucket.sampleNumbers].sort((a, b) => a - b),
    }))
    .sort((a, b) => {
      if (b.affectedSamples !== a.affectedSamples) {
        return b.affectedSamples - a.affectedSamples
      }
      return b.occurrences - a.occurrences
    })
}

const summarizeSolverFailures = (results: WorkerResult[]): FailureSummary[] =>
  summarizeFailures(
    results.filter((result) => !result.didSolve && !result.didTimeout),
  )

const summarizeTimeouts = (results: WorkerResult[]): FailureSummary[] =>
  summarizeFailures(results.filter((result) => result.didTimeout))

const formatFailureSummary = (failureSummary: FailureSummary[]) => {
  if (failureSummary.length === 0) {
    return "No failures recorded."
  }

  return failureSummary
    .slice(0, 10)
    .map(
      (failure, index) =>
        `${index + 1}. ${failure.failureKind}: ${failure.failureKey} - ${failure.affectedSamples} sample${failure.affectedSamples === 1 ? "" : "s"}, ${failure.occurrences} occurrence${failure.occurrences === 1 ? "" : "s"} (samples: ${formatSampleNumbers(failure.sampleNumbers)})`,
    )
    .join("\n")
}

const createChildProcess = (
  cpuIds?: number[],
): ChildProcessWithoutNullStreams => {
  const command = cpuIds ? "taskset" : process.execPath
  const args = cpuIds
    ? [
        "--cpu-list",
        cpuIds.join(","),
        process.execPath,
        "scripts/benchmark/benchmark.child.ts",
      ]
    : ["scripts/benchmark/benchmark.child.ts"]
  return spawn(command, args, {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  })
}

const createWorkerSlot = (id: number, cpuIds?: number[]): WorkerSlot => {
  const child = createChildProcess(cpuIds)
  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")

  return {
    id,
    child,
    stdoutReader: readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    }),
    stderrReader: readline.createInterface({
      input: child.stderr,
      crlfDelay: Infinity,
    }),
    currentTask: null,
    cpuIds,
  }
}

const terminateWorker = async (slot: WorkerSlot, context: string) => {
  const terminateTimeoutMs = getTerminateTimeoutMs()
  const closeInterfaces = () => {
    slot.stdoutReader.close()
    slot.stderrReader.close()
  }

  if (slot.child.killed || slot.child.exitCode !== null) {
    closeInterfaces()
    return
  }

  await new Promise<void>((resolve) => {
    let settled = false
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null

    const finish = () => {
      if (settled) {
        return
      }
      settled = true
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
      slot.child.removeListener("close", onClose)
      closeInterfaces()
      resolve()
    }

    const onClose = () => {
      finish()
    }

    timeoutHandle = setTimeout(() => {
      console.warn(
        `[benchmark] Child termination exceeded ${formatDurationLabel(terminateTimeoutMs)} while ${context}; continuing`,
      )
      finish()
    }, terminateTimeoutMs)

    slot.child.once("close", onClose)
    try {
      slot.child.kill("SIGKILL")
    } catch {
      finish()
    }
  })
}

const replaceWorker = async (slot: WorkerSlot) => {
  const previousWorker: WorkerSlot = {
    id: slot.id,
    child: slot.child,
    stdoutReader: slot.stdoutReader,
    stderrReader: slot.stderrReader,
    currentTask: slot.currentTask,
    cpuIds: slot.cpuIds,
  }
  slot.currentTask = null
  const nextWorker = createWorkerSlot(slot.id, slot.cpuIds)
  slot.child = nextWorker.child
  slot.stdoutReader = nextWorker.stdoutReader
  slot.stderrReader = nextWorker.stderrReader
  await terminateWorker(previousWorker, `replacing worker ${slot.id}`)
}

export const createFailedResult = (
  task: BenchmarkTask,
  elapsedTimeMs: number,
  error: string,
  didTimeout = false,
  latestProgress?: WorkerProgress,
): WorkerResultWithImage => ({
  solverName: task.solverName,
  scenarioName: task.scenarioName,
  sampleNumber: task.sampleNumber,
  elapsedTimeMs,
  peakRssBytes: latestProgress?.peakRssBytes,
  didSolve: false,
  didTimeout,
  relaxedDrcPassed: false,
  errorPhaseName: latestProgress?.phaseName,
  errorSolverName: latestProgress?.phaseSolverName,
  error,
  stageTiming: extendPartialBenchmarkStageTiming({
    stageTiming: latestProgress?.stageTiming,
    activeStageName: latestProgress?.phaseName,
    progressElapsedTimeMs: latestProgress?.elapsedTimeMs,
    finalElapsedTimeMs: elapsedTimeMs,
  }),
})

const getTaskEffort = (task: BenchmarkTask) => {
  const rawEffort = (task.scenario as SimpleRouteJson & { effort?: number })
    .effort
  if (!Number.isFinite(rawEffort) || rawEffort === undefined || rawEffort < 1) {
    return 1
  }
  return rawEffort
}

const getTaskTimeoutMs = (task: BenchmarkTask, sampleTimeoutMs?: number) => {
  if (sampleTimeoutMs !== undefined) {
    return sampleTimeoutMs
  }

  const baseTimeoutMs = DEFAULT_TASK_TIMEOUT_BASE_MS
  const effortTimeoutMs = getTaskTimeoutPerEffortMs()
  return baseTimeoutMs + effortTimeoutMs * getTaskEffort(task)
}

const formatEffortLabel = (efforts: number[]) => {
  const uniqueEfforts = [...new Set(efforts)].sort((a, b) => a - b)
  if (uniqueEfforts.length === 0) {
    return "unknown effort"
  }
  if (uniqueEfforts.length === 1) {
    return `${uniqueEfforts[0]}x effort`
  }
  return "mixed effort"
}

const formatPercentWithTimeoutRate = (
  totalCount: number,
  matchedCount: number,
  timeoutCount: number,
) => {
  if (totalCount === 0) {
    return "n/a"
  }

  const ratePercent = (matchedCount / totalCount) * 100
  if (timeoutCount === 0) {
    return `${ratePercent.toFixed(1)}%`
  }

  const timeoutPercent = (timeoutCount / totalCount) * 100
  return `${ratePercent.toFixed(1)}% (🕒${timeoutPercent.toFixed(1)}%)`
}

const formatProgressDetails = (progress?: WorkerProgress) => {
  if (!progress) {
    return ""
  }

  const details = [
    progress.phaseName ? `phase=${progress.phaseName}` : null,
    progress.phaseSolverName ? `solver=${progress.phaseSolverName}` : null,
    Number.isFinite(progress.solverIterations)
      ? `pipelineIterations=${progress.solverIterations}`
      : null,
    Number.isFinite(progress.activeSubSolverIterations)
      ? `phaseIterations=${progress.activeSubSolverIterations}`
      : null,
    Number.isFinite(progress.solverProgress)
      ? `pipelineProgress=${Math.round((progress.solverProgress ?? 0) * 100)}%`
      : null,
    Number.isFinite(progress.activeSubSolverProgress)
      ? `phaseProgress=${Math.round((progress.activeSubSolverProgress ?? 0) * 100)}%`
      : null,
  ].filter(Boolean)

  return details.length > 0 ? `\nLast progress: ${details.join(", ")}` : ""
}

const executeTaskOnWorker = (
  slot: WorkerSlot,
  request: WorkerTaskMessage,
  sampleTimeoutMs?: number,
  signal?: AbortSignal,
): Promise<WorkerExecutionResult> => {
  return new Promise((resolve) => {
    const taskTimeoutMs = getTaskTimeoutMs(request.task, sampleTimeoutMs)
    const startedAtMs = performance.now()
    let settled = false

    const finish = (result: WorkerResultWithImage, restartWorker: boolean) => {
      if (settled) {
        return
      }
      settled = true
      if (slot.currentTask) {
        clearTimeout(slot.currentTask.timeout)
        slot.currentTask = null
      }
      slot.stdoutReader.removeListener("line", onLine)
      slot.stderrReader.removeListener("line", onStderrLine)
      slot.child.removeListener("error", onError)
      slot.child.removeListener("exit", onExit)
      signal?.removeEventListener("abort", onAbort)
      resolve({
        result: { ...result, sampleTimeoutMs: taskTimeoutMs },
        restartWorker,
      })
    }

    const getElapsedTimeMs = () =>
      Math.max(0, Math.round(performance.now() - startedAtMs))

    const onLine = (line: string) => {
      let message: WorkerChildMessage
      try {
        message = JSON.parse(line) as WorkerChildMessage
      } catch {
        return
      }

      if (message.taskId !== request.taskId) {
        return
      }

      if ("progress" in message) {
        if (slot.currentTask) {
          slot.currentTask.latestProgress = message.progress
        }
        return
      }

      finish(message.result, false)
    }

    const onStderrLine = (line: string) => {
      console.error(`[benchmark-child ${slot.id}] ${line}`)
    }

    const onError = (error: Error) => {
      finish(
        createFailedResult(
          request.task,
          getElapsedTimeMs(),
          `Child process error: ${error.message}${formatProgressDetails(slot.currentTask?.latestProgress)}`,
          false,
          slot.currentTask?.latestProgress,
        ),
        true,
      )
    }

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      finish(
        createFailedResult(
          request.task,
          getElapsedTimeMs(),
          `Child process exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "null"})${formatProgressDetails(slot.currentTask?.latestProgress)}`,
          false,
          slot.currentTask?.latestProgress,
        ),
        true,
      )
    }

    const onAbort = (): void => {
      finish(
        createFailedResult(
          request.task,
          getElapsedTimeMs(),
          "Benchmark execution aborted",
        ),
        true,
      )
    }

    const timeout = setTimeout(() => {
      const latestProgress = slot.currentTask?.latestProgress
      finish(
        createFailedResult(
          request.task,
          taskTimeoutMs,
          `Timed out after ${formatDurationLabel(taskTimeoutMs)}${formatProgressDetails(latestProgress)}`,
          true,
          latestProgress,
        ),
        true,
      )
    }, taskTimeoutMs)

    slot.currentTask = {
      request,
      startedAtMs,
      timeout,
    }

    slot.stdoutReader.on("line", onLine)
    slot.stderrReader.on("line", onStderrLine)
    slot.child.once("error", onError)
    slot.child.once("exit", onExit)
    signal?.addEventListener("abort", onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
      return
    }

    try {
      slot.child.stdin.write(`${JSON.stringify(request)}\n`)
    } catch (error) {
      finish(
        createFailedResult(
          request.task,
          getElapsedTimeMs(),
          `Worker dispatch failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
        true,
      )
    }
  })
}

export const runBenchmarkTasks = async (
  tasks: BenchmarkTask[],
  concurrency: number,
  sampleTimeoutMs?: number,
  options: RunBenchmarkTasksOptions = {},
): Promise<WorkerResult[]> => {
  const executionAbort = new AbortController()
  const signal = options.signal
    ? AbortSignal.any([options.signal, executionAbort.signal])
    : executionAbort.signal
  const workerCount = Math.min(concurrency, tasks.length)
  const heartbeatIntervalMs = getHeartbeatIntervalMs()
  const queue = tasks.map((task, index) => ({
    taskId: index + 1,
    task,
  }))
  const laneQueues = options.cpuLanes
    ? Array.from({ length: workerCount }, (_, laneId) =>
        queue.filter((_, index) => index % workerCount === laneId),
      )
    : undefined
  const results = new Array<WorkerResult>(queue.length)
  let completedTaskCount = 0
  const progress = new Map<
    string,
    {
      completed: number
      solved: number
      total: number
    }
  >()

  for (const task of tasks) {
    const existing = progress.get(task.solverName)
    if (existing) {
      existing.total += 1
      continue
    }
    progress.set(task.solverName, {
      completed: 0,
      solved: 0,
      total: 1,
    })
  }

  const workers = Array.from({ length: workerCount }, (_, index) =>
    createWorkerSlot(index + 1, options.cpuLanes?.[index]),
  )

  const logHeartbeat = (): void => {
    const activeWorkers = workers
      .filter((worker) => worker.currentTask)
      .map((worker) => {
        const currentTask = worker.currentTask
        if (!currentTask) {
          return null
        }

        const elapsedTimeMs = Math.max(
          0,
          Math.round(performance.now() - currentTask.startedAtMs),
        )
        return `worker ${worker.id}: ${currentTask.request.task.scenarioName} ${formatDurationLabel(elapsedTimeMs)}`
      })
      .filter(Boolean)

    const queuedTaskCount = laneQueues
      ? laneQueues.reduce(
          (count, laneQueue): number => count + laneQueue.length,
          0,
        )
      : queue.length
    console.log(
      `[benchmark] heartbeat ${completedTaskCount}/${tasks.length} complete, ${queuedTaskCount} queued, ${activeWorkers.length} running`,
    )

    if (activeWorkers.length > 0) {
      console.log(`[benchmark] active ${activeWorkers.join(" | ")}`)
    }
  }

  const heartbeat =
    heartbeatIntervalMs > 0
      ? setInterval(logHeartbeat, heartbeatIntervalMs)
      : null

  const runWorkerLoop = async (slot: WorkerSlot): Promise<void> => {
    const workerQueue = laneQueues?.[slot.id - 1] ?? queue
    while (workerQueue.length > 0) {
      signal.throwIfAborted()
      const request = workerQueue.shift()
      if (!request) {
        return
      }

      const { result: workerResult, restartWorker } = await executeTaskOnWorker(
        slot,
        request,
        sampleTimeoutMs,
        signal,
      )
      signal.throwIfAborted()
      if (workerResult.benchmarkSnapshot) {
        await options.onBenchmarkSnapshot?.(workerResult.benchmarkSnapshot)
      }
      signal.throwIfAborted()
      let result: WorkerResult = workerResult
      if (workerResult.benchmarkSnapshot) {
        const { imageSvg, ...benchmarkSnapshot } =
          workerResult.benchmarkSnapshot
        result = {
          ...workerResult,
          benchmarkSnapshot,
        }
      }
      results[request.taskId - 1] = result
      completedTaskCount += 1

      const solverProgress = progress.get(result.solverName)
      if (!solverProgress) {
        throw new Error(`Missing progress tracker for ${result.solverName}`)
      }

      solverProgress.completed += 1
      if (result.didSolve) {
        solverProgress.solved += 1
      }

      const status = result.didTimeout
        ? "timed out"
        : result.didSolve
          ? "solved"
          : "failed"
      const successRate =
        solverProgress.completed === 0
          ? 0
          : (solverProgress.solved / solverProgress.completed) * 100
      const suffix = result.error ? ` (${result.error})` : ""
      const memorySuffix =
        result.peakRssBytes === undefined
          ? ""
          : ` peakRss=${formatMemory(result.peakRssBytes)}`
      console.log(
        `[${result.solverName}] ${successRate.toFixed(1)}% success (${solverProgress.solved}/${solverProgress.completed}) ${status} ${result.scenarioName} ${formatTime(result.elapsedTimeMs)}${memorySuffix}${suffix}`,
      )

      if (restartWorker) {
        console.warn(
          `[benchmark] Restarting worker ${slot.id} after ${result.scenarioName}`,
        )
      }
      if (options.cpuLanes && (result.didTimeout || restartWorker)) {
        throw new Error(
          `Local cluster sample ${result.scenarioName} did not finish safely; refusing to overlap outstanding work with the next sample`,
        )
      }
      if (workerQueue.length > 0) {
        signal.throwIfAborted()
        await replaceWorker(slot)
      }
    }
  }

  const workerLoops = workers.map((worker) => runWorkerLoop(worker))
  try {
    await Promise.all(workerLoops)
  } catch (error) {
    executionAbort.abort(error)
    await Promise.allSettled(workerLoops)
    if (options.cpuLanes) {
      await writeFile(
        "benchmark-interrupted.json",
        JSON.stringify(
          {
            error: error instanceof Error ? error.message : String(error),
            completedResults: results.filter(Boolean),
            activeSamples: workers.flatMap((worker) =>
              worker.currentTask
                ? [
                    {
                      laneId: worker.id - 1,
                      task: worker.currentTask.request.task,
                      progress: worker.currentTask.latestProgress,
                    },
                  ]
                : [],
            ),
          },
          null,
          2,
        ),
      )
    }
    throw error
  } finally {
    if (heartbeat) {
      clearInterval(heartbeat)
    }
    for (const worker of workers) {
      await terminateWorker(worker, `shutting down worker ${worker.id}`)
    }
  }

  return results
}

export const summarizeSolverResults = (
  solverName: string,
  results: WorkerResult[],
): SolverRunSummary => {
  const timedOut = results.filter((result) => result.didTimeout)
  const succeeded = results.filter((result) => result.didSolve)
  const elapsedForPercentiles = results.map((result) => {
    if (result.didSolve) return result.elapsedTimeMs
    if (
      result.sampleTimeoutMs === undefined ||
      !Number.isFinite(result.sampleTimeoutMs) ||
      result.sampleTimeoutMs <= 0
    ) {
      throw new Error(
        `Missing or invalid sample timeout for ${solverName} ${result.scenarioName}`,
      )
    }
    return result.sampleTimeoutMs
  })
  const viaCounts = succeeded
    .map((result) => result.viaCount)
    .filter((viaCount): viaCount is number => typeof viaCount === "number")
  const peakRssValues = results
    .map((result) => result.peakRssBytes)
    .filter(
      (peakRssBytes): peakRssBytes is number =>
        typeof peakRssBytes === "number" && Number.isFinite(peakRssBytes),
    )
  const relaxedDrcPassed = succeeded.filter(
    (result) => result.relaxedDrcPassed,
  ).length
  const avgVia =
    viaCounts.length === 0
      ? null
      : viaCounts.reduce((sum, viaCount) => sum + viaCount, 0) /
        viaCounts.length
  const networkMetrics = results.flatMap((result) =>
    result.routingMetrics?.networkedHighDensity
      ? [result.routingMetrics.networkedHighDensity]
      : [],
  )
  const networkCache =
    networkMetrics.length === 0
      ? undefined
      : {
          remoteRequests: networkMetrics.reduce(
            (sum, metrics) => sum + metrics.remoteRequestsStarted,
            0,
          ),
          cacheHits: networkMetrics.reduce(
            (sum, metrics) => sum + metrics.remoteCacheHits,
            0,
          ),
          solverResults: networkMetrics.reduce(
            (sum, metrics) => sum + metrics.remoteSolverResults,
            0,
          ),
          batchCacheMisses: networkMetrics.reduce(
            (sum, metrics) => sum + metrics.remoteBatchCacheMisses,
            0,
          ),
          localFallbacks: networkMetrics.reduce(
            (sum, metrics) => sum + metrics.remoteTransportFallbacks,
            0,
          ),
          ...(networkMetrics.some(
            (metrics): boolean =>
              metrics.remoteFallbackReasonCounts !== undefined,
          )
            ? {
                validationRejections: networkMetrics.reduce(
                  (sum, metrics): number =>
                    sum +
                    countDeterministicNetworkedValidationRejections(metrics),
                  0,
                ),
              }
            : {}),
        }

  return {
    solverName,
    completedRateLabel: formatPercentWithTimeoutRate(
      results.length,
      succeeded.length,
      timedOut.length,
    ),
    relaxedDrcRateLabel: formatPercentWithTimeoutRate(
      results.length,
      relaxedDrcPassed,
      timedOut.length,
    ),
    timedOutLabel: `${timedOut.length}/${results.length}`,
    p50TimeMs: getPercentile(elapsedForPercentiles, 0.5),
    p60TimeMs: getPercentile(elapsedForPercentiles, 0.6),
    p70TimeMs: getPercentile(elapsedForPercentiles, 0.7),
    p80TimeMs: getPercentile(elapsedForPercentiles, 0.8),
    p90TimeMs: getPercentile(elapsedForPercentiles, 0.9),
    p95TimeMs: getPercentile(elapsedForPercentiles, 0.95),
    p50PeakRssBytes: getPercentile(peakRssValues, 0.5),
    p80PeakRssBytes: getPercentile(peakRssValues, 0.8),
    p90PeakRssBytes: getPercentile(peakRssValues, 0.9),
    avgVia,
    avgTraceLintIssues: averageTraceLintIssues(results),
    networkCache,
  } satisfies SolverRunSummary
}

export const validateNetworkedColdPassReadyForHot = (
  results: WorkerResult[],
  options: NetworkedColdHotValidationOptions = {},
): void => {
  const coldResults = results.filter(
    (result) => result.solverName === NETWORKED_PIPELINE9_COLD_NAME,
  )
  if (coldResults.length === 0) {
    throw new Error("Pipeline9_Networked cold pass produced no results")
  }
  const incompleteColdResults = coldResults.filter(
    (result) =>
      result.didTimeout ||
      !result.routingMetrics?.networkedHighDensity ||
      result.routingMetrics.networkedHighDensity.remoteRequestsCompleted !==
        result.routingMetrics.networkedHighDensity.remoteRequestsStarted,
  )
  if (incompleteColdResults.length > 0) {
    throw new Error(
      `Pipeline9_Networked cannot start hot pass because ${incompleteColdResults.length} cold task(s) timed out, crashed, or did not drain remote requests`,
    )
  }
  const coldMetrics = coldResults.map(
    (result) => result.routingMetrics!.networkedHighDensity!,
  )
  const localFallbacks = coldMetrics.reduce(
    (sum, metrics) => sum + metrics.remoteTransportFallbacks,
    0,
  )
  const validationRejections = coldMetrics.map((metrics): number =>
    options.allowValidationRejections
      ? countDeterministicNetworkedValidationRejections(metrics)
      : 0,
  )
  if (
    coldMetrics.some(
      (metrics, index): boolean =>
        metrics.remoteTransportFallbacks !== validationRejections[index],
    )
  ) {
    throw new Error(
      `Pipeline9_Networked cold pass used ${localFallbacks} local transport fallback(s); rejected reason counts: ${JSON.stringify(coldMetrics.map((metrics) => metrics.remoteFallbackReasonCounts))}`,
    )
  }

  const coldRequests = coldMetrics.reduce(
    (sum, metrics) => sum + metrics.remoteRequestsStarted,
    0,
  )
  const coldSolverResults = coldMetrics.reduce(
    (sum, metrics) => sum + metrics.remoteSolverResults,
    0,
  )
  const coldValidationRejections = validationRejections.reduce(
    (sum, count): number => sum + count,
    0,
  )
  if (options.allowValidationRejections) {
    for (const [index, metrics] of coldMetrics.entries()) {
      if (
        metrics.remoteSolverResults +
          metrics.remoteCacheHits +
          validationRejections[index] !==
        metrics.remoteRequestsStarted
      ) {
        throw new Error(
          `Pipeline9_Networked cold sample ${coldResults[index].scenarioName} returned ${metrics.remoteSolverResults} accepted solver result(s) and ${validationRejections[index]} validation rejection(s) for ${metrics.remoteRequestsStarted} request(s) (${metrics.remoteCacheHits} accepted cache hit(s))`,
        )
      }
    }
  }
  if (coldRequests > 0 && coldSolverResults + coldValidationRejections === 0) {
    throw new Error(
      "Pipeline9_Networked cold pass did not produce any remote solver results",
    )
  }
}

export const validateNetworkedColdHotResults = (
  results: WorkerResult[],
  options: NetworkedColdHotValidationOptions = {},
): void => {
  validateNetworkedColdPassReadyForHot(results, options)
  const coldResults = results.filter(
    (result) => result.solverName === NETWORKED_PIPELINE9_COLD_NAME,
  )
  const coldResultCount = coldResults.length
  const hotResults = results.filter(
    (result) => result.solverName === NETWORKED_PIPELINE9_HOT_NAME,
  )
  const incompleteHotResults = hotResults.filter(
    (result) =>
      result.didTimeout ||
      !result.routingMetrics?.networkedHighDensity ||
      result.routingMetrics.networkedHighDensity.remoteRequestsCompleted !==
        result.routingMetrics.networkedHighDensity.remoteRequestsStarted,
  )
  if (
    hotResults.length !== coldResultCount ||
    incompleteHotResults.length > 0
  ) {
    throw new Error(
      `Pipeline9_Networked hot pass completed ${hotResults.length - incompleteHotResults.length}/${coldResultCount} drained task(s)`,
    )
  }
  const hotMetrics = hotResults.map(
    (result) => result.routingMetrics!.networkedHighDensity!,
  )
  const localFallbacks = hotMetrics.reduce(
    (sum, metrics) => sum + metrics.remoteTransportFallbacks,
    0,
  )
  const validationRejections = hotMetrics.map((metrics): number =>
    options.allowValidationRejections
      ? countDeterministicNetworkedValidationRejections(metrics)
      : 0,
  )
  if (
    hotMetrics.some(
      (metrics, index): boolean =>
        metrics.remoteTransportFallbacks !== validationRejections[index],
    )
  ) {
    throw new Error(
      `Pipeline9_Networked hot pass used ${localFallbacks} local transport fallback(s); rejected reason counts: ${JSON.stringify(hotMetrics.map((metrics) => metrics.remoteFallbackReasonCounts))}`,
    )
  }

  const hotRequests = hotMetrics.reduce(
    (sum, metrics) => sum + metrics.remoteRequestsStarted,
    0,
  )
  const hotCacheHits = hotMetrics.reduce(
    (sum, metrics) => sum + metrics.remoteCacheHits,
    0,
  )
  const hotValidationRejections = validationRejections.reduce(
    (sum, count): number => sum + count,
    0,
  )
  if (hotRequests !== hotCacheHits + hotValidationRejections) {
    throw new Error(
      `Pipeline9_Networked hot pass returned ${hotCacheHits}/${hotRequests} remote cache hits and ${hotValidationRejections} validation rejection(s)`,
    )
  }
  if (
    hotMetrics.some(
      (metrics): boolean =>
        metrics.remoteBatchCacheMisses > 0 ||
        metrics.remoteSingleRequestsStarted > 0 ||
        metrics.remoteSolverResults > 0,
    )
  ) {
    throw new Error(
      "Pipeline9_Networked hot pass computed work instead of using only exact cache hits",
    )
  }
  if (options.allowValidationRejections) {
    const coldBySample = new Map(
      coldResults.map((result) => [
        JSON.stringify([result.scenarioName, result.sampleNumber]),
        result,
      ]),
    )
    const visitedSamples = new Set<string>()
    if (coldBySample.size !== coldResults.length) {
      throw new Error("Pipeline9_Networked cold pass repeated a sample")
    }
    for (const hotResult of hotResults) {
      const sampleKey = JSON.stringify([
        hotResult.scenarioName,
        hotResult.sampleNumber,
      ])
      const coldResult = coldBySample.get(sampleKey)
      const hot = hotResult.routingMetrics!.networkedHighDensity!
      if (!coldResult || visitedSamples.has(sampleKey)) {
        throw new Error(
          `Pipeline9_Networked hot pass did not match a unique cold sample ${hotResult.scenarioName} (${hotResult.sampleNumber})`,
        )
      }
      visitedSamples.add(sampleKey)
      const cold = coldResult.routingMetrics!.networkedHighDensity!
      const coldRejected = countDeterministicNetworkedValidationRejections(cold)
      const hotRejected = countDeterministicNetworkedValidationRejections(hot)
      if (hot.remoteCacheHits + hotRejected !== hot.remoteRequestsStarted) {
        throw new Error(
          `Pipeline9_Networked hot sample ${hotResult.scenarioName} did not account for every cached result`,
        )
      }
      if (
        cold.remoteRequestsStarted !== hot.remoteRequestsStarted ||
        coldRejected !== hotRejected
      ) {
        throw new Error(
          `Pipeline9_Networked hot sample ${hotResult.scenarioName} changed request or validation rejection counts: cold ${cold.remoteRequestsStarted} request(s), ${coldRejected} rejection(s); hot ${hot.remoteRequestsStarted} request(s), ${hotRejected} rejection(s)`,
        )
      }
      if (
        coldResult.didSolve !== hotResult.didSolve ||
        coldResult.relaxedDrcPassed !== hotResult.relaxedDrcPassed ||
        coldResult.viaCount !== hotResult.viaCount ||
        coldResult.drcErrorCount !== hotResult.drcErrorCount
      ) {
        throw new Error(
          `Pipeline9_Networked hot sample ${hotResult.scenarioName} changed routing result: cold ${JSON.stringify({ didSolve: coldResult.didSolve, relaxedDrcPassed: coldResult.relaxedDrcPassed, viaCount: coldResult.viaCount, drcErrorCount: coldResult.drcErrorCount })}; hot ${JSON.stringify({ didSolve: hotResult.didSolve, relaxedDrcPassed: hotResult.relaxedDrcPassed, viaCount: hotResult.viaCount, drcErrorCount: hotResult.drcErrorCount })}`,
        )
      }
    }
  }
}

const main = async () => {
  const options = parseArgs()
  const {
    solverName,
    networkedColdHot,
    scenarioLimit,
    sampleNumbers,
    networkedRemote,
    effort,
    sampleTimeoutMs,
    excludeAssignable,
    datasetName,
  } = options
  let concurrency = options.concurrency
  if (options.threads !== undefined) {
    concurrency = getBenchmarkThreadConcurrency(concurrency, options.threads)
  }
  if ((options.threads ?? 1) > 1) {
    // Build once before child processes start, using this revision's algorithms.
    await import("../build-solver-workers")
  }
  const useLocalCluster =
    solverName === NETWORKED_PIPELINE9_SOLVER_NAME && !networkedRemote
  const resourcePlan = useLocalCluster
    ? planLocalHighDensityClusterResources({
        topology: readLocalCpuTopology(),
        concurrency: options.concurrencyWasSet ? concurrency : undefined,
      })
    : undefined
  if (resourcePlan) concurrency = resourcePlan.laneCount
  const availableSolvers = await loadSolverNames(excludeAssignable)
  const solvers = solverName ? [solverName] : [DEFAULT_BENCHMARK_SOLVER_NAME]

  if (
    networkedColdHot &&
    (solverName !== NETWORKED_PIPELINE9_SOLVER_NAME ||
      (effort !== undefined && effort !== 1))
  ) {
    throw new Error(
      "--networked-cold-hot requires AutoroutingPipelineSolver9_Networked at effort=1",
    )
  }

  if (solverName && !availableSolvers.includes(solverName)) {
    throw new Error(
      `Unknown solver \"${solverName}\". Available: ${availableSolvers.join(", ")}`,
    )
  }
  if (
    !solverName &&
    !availableSolvers.includes(DEFAULT_BENCHMARK_SOLVER_NAME)
  ) {
    throw new Error(
      `Default benchmark solver "${DEFAULT_BENCHMARK_SOLVER_NAME}" was not found. Available: ${availableSolvers.join(", ")}`,
    )
  }

  const loadedScenarios = await loadScenarios(datasetName, {
    scenarioLimit,
    effort,
  })
  const scenarios =
    sampleNumbers === undefined
      ? loadedScenarios.map(([scenarioName, scenario], scenarioIndex) => ({
          scenarioName,
          scenario,
          sampleNumber: scenarioIndex + 1,
        }))
      : sampleNumbers.map((sampleNumber) => {
          const scenario = loadedScenarios[sampleNumber - 1]
          if (!scenario) {
            throw new Error(
              `Sample ${sampleNumber} is out of range for dataset ${datasetName} (${loadedScenarios.length} samples)`,
            )
          }
          return {
            scenarioName: scenario[0],
            scenario: scenario[1],
            sampleNumber,
          }
        })
  if (scenarios.length === 0) {
    throw new Error(`No benchmark scenarios found for dataset "${datasetName}"`)
  }

  const solverRuns: Array<{
    displayName: string
    constructorName: string
    networkedCachePass?: "cold" | "hot"
  }> = networkedColdHot
    ? [
        {
          displayName: NETWORKED_PIPELINE9_COLD_NAME,
          constructorName: NETWORKED_PIPELINE9_SOLVER_NAME,
          networkedCachePass: "cold",
        },
        {
          displayName: NETWORKED_PIPELINE9_HOT_NAME,
          constructorName: NETWORKED_PIPELINE9_SOLVER_NAME,
          networkedCachePass: "hot",
        },
      ]
    : solvers.map((solver) => ({
        displayName: solver,
        constructorName: solver,
      }))
  const taskGroups: BenchmarkTask[][] = networkedColdHot
    ? solverRuns.map((solverRun) =>
        scenarios.map(
          ({ scenarioName, sampleNumber, scenario }) =>
            ({
              datasetName,
              threads: options.threads,
              captureFinalSrj: options.captureFinalSrj,
              solverName: solverRun.displayName,
              solverConstructorName: solverRun.constructorName,
              networkedCachePass: solverRun.networkedCachePass,
              scenarioName,
              sampleNumber,
              scenario,
            }) satisfies BenchmarkTask,
        ),
      )
    : [
        solverRuns.flatMap((solverRun) =>
          scenarios.map(
            ({ scenarioName, sampleNumber, scenario }) =>
              ({
                datasetName,
                threads: options.threads,
                captureFinalSrj: options.captureFinalSrj,
                solverName: solverRun.displayName,
                solverConstructorName: solverRun.constructorName,
                scenarioName,
                sampleNumber,
                scenario,
              }) satisfies BenchmarkTask,
          ),
        ),
      ]
  const tasks = taskGroups.flat()
  const runtime = getBenchmarkRuntimeMetadata(
    options.concurrency,
    Math.min(concurrency, Math.max(...taskGroups.map((group) => group.length))),
  )
  runtime.threadsPerSample = options.threads ?? 1
  runtime.effectiveThreadsPerSample = options.threads ?? 1
  runtime.cpuBudgetPerSample =
    (options.threads ?? 1) === 1 ? 1 : options.threads! + 1
  if (resourcePlan) {
    concurrency = Math.min(concurrency, scenarios.length)
    runtime.workerCount = concurrency
    runtime.localHighDensityCluster = {
      serversPerLane: 8,
      laneCount: concurrency,
      effectiveCpuCount: resourcePlan.effectiveCpuCount,
      laneCpuIds: resourcePlan.lanes
        .slice(0, concurrency)
        .map((lane) => lane.coordinatorCpuIds),
      sampleAssignment: "fixed_round_robin",
      cacheIsolation: "per_sample",
      passStats: [],
    }
    const cpuIds = resourcePlan.lanes
      .slice(0, concurrency)
      .flatMap((lane) => lane.coordinatorCpuIds)
    const affinity = spawnSync(
      "taskset",
      [
        "--all-tasks",
        "--pid",
        "--cpu-list",
        cpuIds.join(","),
        String(process.pid),
      ],
      { encoding: "utf8" },
    )
    if (affinity.status !== 0) {
      throw new Error(
        `Cannot pin the local benchmark controller: ${affinity.error?.message ?? affinity.stderr}`,
      )
    }
  }

  console.log(
    `Running ${tasks.length} benchmark tasks across ${concurrency} sample workers, ${options.threads ?? 1} routing threads per sample (${solverRuns.length} solver run${solverRuns.length === 1 ? "" : "s"}, ${scenarios.length} scenario${scenarios.length === 1 ? "" : "s"}, dataset: ${datasetName}, isolated per-sample memory measurement)`,
  )
  console.log(`[benchmark] runtime ${JSON.stringify(runtime)}`)

  const networkedCachePropagationDelayMs = networkedColdHot
    ? useLocalCluster
      ? 0
      : parseNetworkedCachePropagationDelayMs()
    : 0
  const results: WorkerResult[] = []
  const clusters: LocalHighDensityCluster[] = []
  let coldClusterStats: LocalHighDensityClusterStats[] | undefined
  const runAbort = new AbortController()
  const onInterrupt = (): void => {
    if (!runAbort.signal.aborted) {
      runAbort.abort(new Error("Benchmark interrupted by SIGINT"))
      process.exitCode = 130
    }
  }
  const onTerminate = (): void => {
    if (!runAbort.signal.aborted) {
      runAbort.abort(new Error("Benchmark interrupted by SIGTERM"))
      process.exitCode = 143
    }
  }
  process.once("SIGINT", onInterrupt)
  process.once("SIGTERM", onTerminate)
  let snapshotWriter: BenchmarkSnapshotWriter | undefined
  try {
    if (resourcePlan) {
      for (const lane of resourcePlan.lanes.slice(0, concurrency)) {
        const cluster = await startLocalHighDensityCluster({
          autorouterVersion: AUTOROUTER_VERSION,
          serverCpuIds: lane.serverCpuIds,
          signal: runAbort.signal,
        })
        clusters.push(cluster)
        void cluster.fault.catch((error: unknown): void => {
          if (!runAbort.signal.aborted) {
            runAbort.abort(error)
          }
        })
      }
    }
    const runNamespace = randomUUID()
    for (const taskGroup of taskGroups) {
      for (const [index, task] of taskGroup.entries()) {
        if (resourcePlan) {
          task.networkedServer = {
            backend: "local",
            url: clusters[index % concurrency]!.url,
            cacheVersion: `${runNamespace}-sample-${index + 1}`,
            requestTimeoutMs: getTaskTimeoutMs(task, sampleTimeoutMs),
          }
        } else if (networkedRemote) {
          const cacheVersion = process.env.HD_CACHE2_CACHE_VERSION
          const url = process.env.HD_CACHE2_SERVER_URL
          if (!cacheVersion || !url) {
            throw new Error(
              "--networked-remote requires HD_CACHE2_CACHE_VERSION and HD_CACHE2_SERVER_URL",
            )
          }
          task.networkedServer = { url, cacheVersion, backend: "remote" }
        }
      }
    }
    snapshotWriter = await createBenchmarkSnapshotWriter(
      BENCHMARK_SNAPSHOTS_HTML_PATH,
    )
    for (const [groupIndex, taskGroup] of taskGroups.entries()) {
      runAbort.signal.throwIfAborted()
      for (const cluster of clusters) cluster.assertHealthy()
      if (networkedColdHot) {
        console.log(
          `[benchmark] Starting Pipeline9_Networked ${groupIndex === 0 ? "cold" : "hot"} pass`,
        )
      }
      results.push(
        ...(await runBenchmarkTasks(taskGroup, concurrency, sampleTimeoutMs, {
          onBenchmarkSnapshot: snapshotWriter.writeSnapshot,
          cpuLanes: resourcePlan?.lanes
            .slice(0, concurrency)
            .map((lane) => lane.coordinatorCpuIds),
          signal: runAbort.signal,
        })),
      )
      if (useLocalCluster && networkedColdHot) {
        const laneStats = await Promise.all(
          clusters.map((cluster) => cluster.getStats()),
        )
        const pass = groupIndex === 0 ? "cold" : "hot"
        runtime.localHighDensityCluster!.passStats!.push({
          pass,
          lanes: laneStats,
        })
        console.log(
          `[benchmark] local ${pass} server stats ${JSON.stringify(laneStats)}`,
        )
        if (groupIndex === 0) {
          coldClusterStats = laneStats
        } else {
          if (
            !coldClusterStats ||
            coldClusterStats.length !== laneStats.length
          ) {
            throw new Error(
              "Local high-density hot pass has no matching cold server statistics",
            )
          }
          for (const [lane, stats] of laneStats.entries()) {
            const cold = coldClusterStats[lane]
            if (stats.servers.length !== cold.servers.length) {
              throw new Error(
                "Local high-density server count changed before the hot pass",
              )
            }
            for (const [index, server] of stats.servers.entries()) {
              const previous = cold.servers[index]
              if (
                server.pid !== previous.pid ||
                server.cpuId !== previous.cpuId ||
                server.stats.jobsComputed !== previous.stats.jobsComputed ||
                server.stats.solveRequests !== previous.stats.solveRequests
              ) {
                throw new Error(
                  `Local high-density hot pass changed server identity or computed new work in lane ${lane + 1}, server ${index + 1}`,
                )
              }
            }
          }
        }
      }
      if (networkedColdHot && groupIndex === 0) {
        validateNetworkedColdPassReadyForHot(results, {
          allowValidationRejections: useLocalCluster,
        })
        if (networkedCachePropagationDelayMs > 0) {
          console.log(
            `[benchmark] Waiting ${networkedCachePropagationDelayMs}ms for Workers KV propagation before the hot pass`,
          )
          await new Promise((resolve) =>
            setTimeout(resolve, networkedCachePropagationDelayMs),
          )
        }
      }
    }
    if (networkedColdHot) {
      validateNetworkedColdHotResults(results, {
        allowValidationRejections: useLocalCluster,
      })
    }
  } catch (error) {
    if (resourcePlan) {
      await writeFile(
        "benchmark-failure.json",
        JSON.stringify(
          {
            error: error instanceof Error ? error.message : String(error),
            runtime,
            completedPassResults: results,
          },
          null,
          2,
        ),
      )
    }
    throw error
  } finally {
    try {
      await snapshotWriter?.finish()
    } finally {
      try {
        await Promise.all(clusters.map((cluster) => cluster.stop()))
      } finally {
        process.removeListener("SIGINT", onInterrupt)
        process.removeListener("SIGTERM", onTerminate)
      }
    }
  }
  const rows = solverRuns.map((solverRun) =>
    summarizeSolverResults(
      solverRun.displayName,
      results.filter((result) => result.solverName === solverRun.displayName),
    ),
  )

  const effortLabel = formatEffortLabel(
    scenarios.map(({ scenario }) =>
      getTaskEffort({
        datasetName,
        solverName: solverRuns[0]?.displayName ?? "",
        solverConstructorName: solverRuns[0]?.constructorName,
        scenarioName: "",
        sampleNumber: 0,
        scenario,
      }),
    ),
  )
  const table = `${formatTable(rows)}\n\n${formatTraceLintTable(rows)}`
  const solverFailureSummary = summarizeSolverFailures(results)
  const solverFailureSummaryText = formatFailureSummary(solverFailureSummary)
  const timeoutSummary = summarizeTimeouts(results)
  const timeoutSummaryText = formatFailureSummary(timeoutSummary)
  const failureSummary = summarizeFailures(results)
  const failureSummaryText = formatFailureSummary(failureSummary)
  const snapshots = results.flatMap((result): BenchmarkSnapshot[] =>
    result.benchmarkSnapshot ? [result.benchmarkSnapshot] : [],
  )
  const output: string = `Benchmark Results (${effortLabel})\n\n${table}\n\nDataset: ${datasetName}\nScenarios: ${scenarios.length}\n\nTop solver failure buckets:\n${solverFailureSummaryText}\n\nTop timeout buckets:\n${timeoutSummaryText}\n\nTop failure buckets:\n${failureSummaryText}\n`
  const report: BenchmarkReport = {
    version: 1,
    datasetName,
    memoryMeasurementMode: "isolated_process_per_sample",
    runtime,
    scenarioCount: scenarios.length,
    effortLabel,
    summary: rows,
    solverFailureSummary,
    timeoutSummary,
    failureSummary,
    snapshots,
    tests: results,
  }
  await Bun.write("benchmark-result.txt", output)
  await Bun.write("benchmark-result.json", JSON.stringify(report, null, 2))
  if (options.captureFinalSrj) {
    logCapturedFinalSrjs(results)
    logCapturedPathingDiagnostics(results)
  }

  console.log(`\nBenchmark Results (${effortLabel})\n`)
  console.log(table)
  console.log(`\nDataset: ${datasetName}`)
  console.log(`\nScenarios: ${scenarios.length}`)
  console.log("\nTop solver failure buckets:")
  console.log(solverFailureSummaryText)
  console.log("\nTop timeout buckets:")
  console.log(timeoutSummaryText)
  console.log("\nTop failure buckets:")
  console.log(failureSummaryText)
  console.log(
    `Results written to benchmark-result.txt, benchmark-result.json, and ${BENCHMARK_SNAPSHOTS_HTML_PATH}`,
  )
}

if (import.meta.main) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Benchmark failed: ${message}`)
    process.exitCode ??= 1
    process.exit()
  })
}
