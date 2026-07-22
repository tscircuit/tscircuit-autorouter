#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import type { BenchmarkReport, SolverRunSummary, WorkerResult } from "./benchmark-types"

export type BenchmarkReportCollection = {
  version: 2
  kind: "benchmark-report-collection"
  generatedFor: "main"
  reports: BenchmarkReport[]
}

export type BenchmarkHistoryRun = {
  version: 1
  runId: string
  workflowRunId: string
  workflowRunAttempt: number
  runUrl: string
  commitSha: string
  createdAt: string
  runner: string
  metadata: Record<string, unknown>
  report: BenchmarkReport | BenchmarkReportCollection
}

export type BenchmarkHistoryIndex = {
  version: 1
  runs: Array<{
    runId: string
    createdAt: string
    path: string
  }>
}

type DashboardPoint = {
  runId: string
  runUrl: string
  createdAt: string
  datasetName: string
  solverName: string
  effortLabel: string
  completedRate: number | null
  relaxedDrcRate: number | null
  p50TimeMs: number | null
  p90TimeMs: number | null
  p95TimeMs: number | null
  maxTimeMs: number | null
  avgVia: number | null
  medianVia: number | null
  maxVia: number | null
  samples: WorkerResult[]
}

const HISTORY_INDEX_NAME = "index.json"
const HISTORY_RUNS_DIRECTORY = "runs"
const DASHBOARD_RUN_LIMIT = 100

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const getPercentile = (
  values: number[],
  percentile: number,
): number | null => {
  if (values.length === 0) return null
  const sortedValues = [...values].sort((a, b) => a - b)
  const index = (sortedValues.length - 1) * percentile
  const lowerIndex = Math.floor(index)
  const upperIndex = Math.ceil(index)
  const lowerValue = sortedValues[lowerIndex]!
  const upperValue = sortedValues[upperIndex]!
  return lowerValue + (upperValue - lowerValue) * (index - lowerIndex)
}

const parseRate = (label: string): number | null => {
  const match = /^(\d+(?:\.\d+)?)%/.exec(label.trim())
  if (!match) return null
  const rate = Number(match[1])
  return Number.isFinite(rate) ? rate : null
}

const getReports = (
  report: BenchmarkReport | BenchmarkReportCollection,
): BenchmarkReport[] => {
  if (isRecord(report) && report.kind === "benchmark-report-collection") {
    return report.reports
  }
  return [report as BenchmarkReport]
}

const makeDashboardPoint = (
  run: BenchmarkHistoryRun,
  report: BenchmarkReport,
  summary: SolverRunSummary,
): DashboardPoint => {
  const samples = report.tests.filter(
    (test) => test.solverName === summary.solverName,
  )
  const completedSamples = samples.filter((sample) => sample.didSolve)
  const solveTimes = completedSamples.map((sample) => sample.elapsedTimeMs)
  const viaCounts = completedSamples
    .map((sample) => sample.viaCount)
    .filter((viaCount): viaCount is number => typeof viaCount === "number")

  return {
    runId: run.runId,
    runUrl: run.runUrl,
    createdAt: run.createdAt,
    datasetName: report.datasetName,
    solverName: summary.solverName,
    effortLabel: report.effortLabel,
    completedRate: parseRate(summary.completedRateLabel),
    relaxedDrcRate: parseRate(summary.relaxedDrcRateLabel),
    p50TimeMs: summary.p50TimeMs,
    p90TimeMs: getPercentile(solveTimes, 0.9),
    p95TimeMs: summary.p95TimeMs,
    maxTimeMs: solveTimes.length === 0 ? null : Math.max(...solveTimes),
    avgVia: summary.avgVia,
    medianVia: getPercentile(viaCounts, 0.5),
    maxVia: viaCounts.length === 0 ? null : Math.max(...viaCounts),
    samples,
  }
}

export const getDashboardPoints = (
  runs: BenchmarkHistoryRun[],
): DashboardPoint[] =>
  runs.flatMap((run) =>
    getReports(run.report).flatMap((report) =>
      report.summary.map((summary) => makeDashboardPoint(run, report, summary)),
    ),
  )

const encodeJsonForHtml = (value: unknown): string =>
  JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e")

export const createBenchmarkHistoryDashboard = (
  allRuns: BenchmarkHistoryRun[],
): string => {
  const runs = [...allRuns].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  )
  const points = getDashboardPoints(runs.slice(-DASHBOARD_RUN_LIMIT))
  const data = encodeJsonForHtml({
    runs,
    points,
    dashboardRunLimit: DASHBOARD_RUN_LIMIT,
  })

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Autorouter benchmark history</title>
<style>
body{margin:0;background:#0b1020;color:#e6edf7;font:14px system-ui,sans-serif}main{max-width:1500px;margin:auto;padding:24px}.controls,.metrics{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin:16px 0}select,button{background:#16213a;color:inherit;border:1px solid #3a4b70;border-radius:5px;padding:7px}label{display:flex;gap:5px;align-items:center}#chart{width:100%;height:460px;background:#111a2e;border-radius:8px}#legend{display:flex;gap:16px;flex-wrap:wrap}.legend-item{display:flex;gap:6px;align-items:center}.dot{width:10px;height:10px;border-radius:50%}table{border-collapse:collapse;width:100%;margin-top:20px;font-size:12px}th,td{padding:7px;border-bottom:1px solid #283653;text-align:left}tr:hover{background:#16213a}a{color:#88c7ff}.muted{color:#9aabc7}.detail{max-height:380px;overflow:auto}code{font-family:ui-monospace,monospace}
</style>
</head>
<body><main>
<h1>Autorouter benchmark history</h1>
<p class="muted">Full raw results are embedded in this artifact. Charts show the latest 100 successful full main workflow runs; solve-time percentiles use completed samples only.</p>
<div class="controls"><label>Series <select id="series"></select></label><label>Sample <select id="sample"><option value="">All samples</option></select></label></div>
<div class="metrics"><label>Metric <select id="metric"></select></label></div><svg id="chart" viewBox="0 0 1200 460" preserveAspectRatio="none"></svg><div id="legend"></div>
<h2>Selected run data</h2><p class="muted" id="selected">Click a chart point to inspect its raw samples.</p><div class="detail"><table id="samples"></table></div>
</main><script id="benchmark-history-data" type="application/json">${data}</script>
<script>
const state=JSON.parse(document.getElementById('benchmark-history-data').textContent)
const colors=['#73daca','#f7768e','#7aa2f7','#e0af68','#bb9af7','#7dcfff','#9ece6a','#ff9e64']
const metricDefs=[['completedRate','Completion %'],['relaxedDrcRate','Relaxed DRC %'],['p50TimeMs','P50 solve ms'],['p90TimeMs','P90 solve ms'],['p95TimeMs','P95 solve ms'],['maxTimeMs','Max solve ms'],['avgVia','Average vias'],['medianVia','Median vias'],['maxVia','Max vias']]
const series=document.getElementById('series'),sample=document.getElementById('sample'),metric=document.getElementById('metric'),chart=document.getElementById('chart'),legend=document.getElementById('legend'),selected=document.getElementById('selected'),samples=document.getElementById('samples')
const keyOf=p=>[p.datasetName,p.solverName,p.effortLabel].join(' | ')
const seriesKeys=[...new Set(state.points.map(keyOf))].sort()
series.innerHTML=seriesKeys.map(key=>'<option>'+escapeHtml(key)+'</option>').join('')
const sampleNumbers=[...new Set(state.points.flatMap(point=>point.samples.map(item=>item.sampleNumber)))].sort((a,b)=>a-b)
sample.innerHTML += sampleNumbers.map(number=>'<option value="'+number+'">Sample '+number+'</option>').join('')
metric.innerHTML=metricDefs.map(([key,label])=>'<option value="'+key+'">'+label+'</option>').join('')
function escapeHtml(value){return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}
function format(value){if(value===null||value===undefined)return 'n/a';return typeof value==='number'?value.toFixed(2):String(value)}
function getFilteredPoints(){const sampleNumber=Number(sample.value)||null;return state.points.filter(point=>keyOf(point)===series.value).map(point=>{if(!sampleNumber)return point;const raw=point.samples.find(item=>item.sampleNumber===sampleNumber);return raw?{...point,completedRate:raw.didSolve?100:0,relaxedDrcRate:raw.relaxedDrcPassed?100:0,p50TimeMs:raw.elapsedTimeMs,p90TimeMs:raw.elapsedTimeMs,p95TimeMs:raw.elapsedTimeMs,maxTimeMs:raw.elapsedTimeMs,avgVia:raw.viaCount??null,medianVia:raw.viaCount??null,maxVia:raw.viaCount??null,samples:[raw]}:null}).filter(Boolean)}
function renderSamples(point){selected.innerHTML='Run <a href="'+escapeHtml(point.runUrl)+'">#'+escapeHtml(point.runId)+'</a> · '+escapeHtml(point.createdAt)+' · '+escapeHtml(point.datasetName)+' · '+escapeHtml(point.solverName);samples.innerHTML='<thead><tr><th>Sample</th><th>Status</th><th>Time (ms)</th><th>DRC</th><th>Vias</th><th>Error phase</th><th>Error</th></tr></thead><tbody>'+point.samples.map(item=>'<tr><td>'+item.sampleNumber+'</td><td>'+(item.didTimeout?'Timeout':item.didSolve?'Solved':'Failed')+'</td><td>'+format(item.elapsedTimeMs)+'</td><td>'+(item.relaxedDrcPassed?'Passed':'Failed')+'</td><td>'+format(item.viaCount)+'</td><td>'+escapeHtml(item.errorPhaseName||'')+'</td><td>'+escapeHtml(item.error||'')+'</td></tr>').join('')+'</tbody>'}
function render(){const points=getFilteredPoints(),key=metric.value;chart.innerHTML='';legend.innerHTML='';if(!points.length)return;const values=points.map(point=>point[key]).filter(value=>typeof value==='number'&&Number.isFinite(value));if(!values.length)return;const min=Math.min(...values),max=Math.max(...values),padding=min===max?(Math.abs(min)*0.05||1):0,domainMin=min-padding,domainMax=max+padding,range=domainMax-domainMin;const ns='http://www.w3.org/2000/svg';const make=(name,attrs)=>{const element=document.createElementNS(ns,name);Object.entries(attrs).forEach(([key,value])=>element.setAttribute(key,String(value)));return element};for(let row=0;row<5;row++){const y=35+row*95;chart.append(make('line',{x1:55,y1:y,x2:1175,y2:y,stroke:'#283653'}));const text=make('text',{x:5,y:y+4,fill:'#9aabc7','font-size':12});text.textContent=format(domainMax-(range*row/4));chart.append(text)}const color=colors[0],linePoints=[];points.forEach((point,pointIndex)=>{const value=point[key];if(typeof value!=='number'||!Number.isFinite(value))return;const x=55+(1120*(points.length===1?0.5:pointIndex/(points.length-1))),y=415-((value-domainMin)/range*380);linePoints.push(x+','+y);const circle=make('circle',{cx:x,cy:y,r:5,fill:color,style:'cursor:pointer'});circle.addEventListener('click',()=>renderSamples(point));chart.append(circle)});chart.append(make('polyline',{points:linePoints.join(' '),fill:'none',stroke:color,'stroke-width':3,'pointer-events':'none'}));legend.innerHTML='<span class="legend-item"><i class="dot" style="background:'+color+'"></i>'+metricDefs.find(item=>item[0]===key)[1]+'</span>'}
series.addEventListener('change',render);sample.addEventListener('change',render);metric.addEventListener('change',render);render()
</script></body></html>`
}

export const readHistoryRuns = async (
  historyDirectory: string,
): Promise<BenchmarkHistoryRun[]> => {
  const indexPath = join(historyDirectory, HISTORY_INDEX_NAME)
  if (!existsSync(indexPath)) return []
  const index = JSON.parse(await readFile(indexPath, "utf8")) as BenchmarkHistoryIndex
  if (index.version !== 1 || !Array.isArray(index.runs)) {
    throw new Error(`Invalid benchmark history index: ${indexPath}`)
  }
  return Promise.all(
    index.runs.map(async (entry) =>
      JSON.parse(await readFile(join(historyDirectory, entry.path), "utf8")) as BenchmarkHistoryRun,
    ),
  )
}

export const appendHistoryRun = async ({
  historyDirectory,
  run,
}: {
  historyDirectory: string
  run: BenchmarkHistoryRun
}): Promise<BenchmarkHistoryRun[]> => {
  const runs = await readHistoryRuns(historyDirectory)
  const existingRun = runs.find((entry) => entry.runId === run.runId)
  if (existingRun) {
    if (JSON.stringify(existingRun) !== JSON.stringify(run)) {
      throw new Error(`Benchmark history contains conflicting workflow run ${run.runId}`)
    }
    return runs
  }
  const relativePath = join(HISTORY_RUNS_DIRECTORY, `${run.runId}.json`)
  await mkdir(join(historyDirectory, HISTORY_RUNS_DIRECTORY), { recursive: true })
  await writeFile(join(historyDirectory, relativePath), JSON.stringify(run, null, 2))
  const index: BenchmarkHistoryIndex = {
    version: 1,
    runs: [...runs, run]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((entry) => ({
        runId: entry.runId,
        createdAt: entry.createdAt,
        path: join(HISTORY_RUNS_DIRECTORY, `${entry.runId}.json`),
      })),
  }
  await writeFile(join(historyDirectory, HISTORY_INDEX_NAME), JSON.stringify(index, null, 2))
  return [...runs, run]
}

const getRequiredArg = (args: string[], name: string): string => {
  const index = args.indexOf(name)
  const value = index === -1 ? undefined : args[index + 1]
  if (!value || value.startsWith("--")) throw new Error(`Missing ${name}`)
  return value
}

const getRequiredMetadataString = (
  metadata: Record<string, unknown>,
  name: string,
): string => {
  const value = metadata[name]
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Benchmark metadata is missing ${name}`)
  }
  return value
}

const getRequiredMetadataPositiveInteger = (
  metadata: Record<string, unknown>,
  name: string,
): number => {
  const value = metadata[name]
  const parsedValue =
    typeof value === "string"
      ? Number(value)
      : typeof value === "number"
        ? value
        : Number.NaN
  if (!Number.isInteger(parsedValue) || parsedValue < 1) {
    throw new Error(`Benchmark metadata ${name} must be a positive integer`)
  }
  return parsedValue
}

const main = async (): Promise<void> => {
  const args = process.argv.slice(2)
  if (args[0] === "render") {
    const historyDirectory = getRequiredArg(args, "--history-dir")
    await writeFile(
      getRequiredArg(args, "--out"),
      createBenchmarkHistoryDashboard(await readHistoryRuns(historyDirectory)),
    )
    return
  }
  if (args[0] !== "record") {
    throw new Error("Usage: benchmark-history.ts <record|render> --history-dir <path> [record options]")
  }
  const reportPath = getRequiredArg(args, "--report")
  const historyDirectory = getRequiredArg(args, "--history-dir")
  const report = JSON.parse(await readFile(reportPath, "utf8")) as BenchmarkReport | BenchmarkReportCollection
  const metadata = JSON.parse(
    await readFile(getRequiredArg(args, "--metadata"), "utf8"),
  ) as Record<string, unknown>
  if (!isRecord(metadata.runner)) {
    throw new Error("Benchmark metadata is missing runner")
  }
  const runner = getRequiredMetadataString(metadata.runner, "name")
  const workflowRunId = getRequiredMetadataString(metadata, "workflowRunId")
  const workflowRunAttempt = getRequiredMetadataPositiveInteger(
    metadata,
    "workflowRunAttempt",
  )
  const createdAt = getRequiredMetadataString(metadata, "createdAt")
  if (Number.isNaN(Date.parse(createdAt))) {
    throw new Error("Benchmark metadata createdAt must be a valid timestamp")
  }
  const runs = await appendHistoryRun({
    historyDirectory,
    run: {
      version: 1,
      runId: `${workflowRunId}-${workflowRunAttempt}`,
      workflowRunId,
      workflowRunAttempt,
      runUrl: getRequiredArg(args, "--run-url"),
      commitSha: getRequiredMetadataString(metadata, "commitSha"),
      createdAt,
      runner,
      metadata,
      report,
    },
  })
  await writeFile(getRequiredArg(args, "--out"), createBenchmarkHistoryDashboard(runs))
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
