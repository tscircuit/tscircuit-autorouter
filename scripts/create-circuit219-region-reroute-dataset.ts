#!/usr/bin/env bun

import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import bugReport49 from "../fixtures/bug-reports/bugreport49-8536f4/bugreport49-8536f4.json" with {
  type: "json",
}
import bugReport50 from "../fixtures/bug-reports/bugreport50-e1c376/bugreport50-e1c376.json" with {
  type: "json",
}
import bugReport51 from "../fixtures/bug-reports/bugreport51-7db9f8/bugreport51-7db9f8.json" with {
  type: "json",
}
import {
  AutoroutingPipelineSolver4,
  type RerouteRectRegion,
  getRerouteSimpleRouteJson,
} from "../lib"
import type { SimpleRouteJson } from "../lib/types"

const OUTPUT_DIR = path.join(process.cwd(), "fixtures/datasets/dataset-srj15")
const RANDOM_SEED = 219_015
const MIN_REGION_SIZE = 10
const MAX_REGION_SIZE = 20
const MAX_REGION_ATTEMPTS = 100
const GRID_COLUMNS = 5
const GRID_ROWS = 5

type BugReportJson = {
  simple_route_json: SimpleRouteJson
}

type DatasetSource = {
  sourceDataset: string
  sourceCircuit: string
  randomSeed: number
  sampleCount: number
  getSrj: () => SimpleRouteJson
}

const getCircuit219 = () =>
  (dataset01 as Record<string, unknown>).circuit219 as SimpleRouteJson

const getBugReportSrj = (bugReport: BugReportJson) =>
  bugReport.simple_route_json

const DATASET_SOURCES: DatasetSource[] = [
  {
    sourceDataset: "dataset01",
    sourceCircuit: "circuit219",
    randomSeed: RANDOM_SEED,
    sampleCount: 25,
    getSrj: getCircuit219,
  },
  {
    sourceDataset: "bugreport49",
    sourceCircuit: "bugreport49-8536f4",
    randomSeed: 49_015,
    sampleCount: 10,
    getSrj: () => getBugReportSrj(bugReport49 as BugReportJson),
  },
  {
    sourceDataset: "bugreport50",
    sourceCircuit: "bugreport50-e1c376",
    randomSeed: 50_015,
    sampleCount: 10,
    getSrj: () => getBugReportSrj(bugReport50 as BugReportJson),
  },
  {
    sourceDataset: "bugreport51",
    sourceCircuit: "bugreport51-7db9f8",
    randomSeed: 51_015,
    sampleCount: 10,
    getSrj: () => getBugReportSrj(bugReport51 as BugReportJson),
  },
]

const createSeededRandom = (seed: number) => {
  let state = seed >>> 0

  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

const stringifyJson = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

const getStratifiedRandomRegion = (
  bounds: SimpleRouteJson["bounds"],
  random: () => number,
  sampleIndex: number,
): RerouteRectRegion => {
  const width = MIN_REGION_SIZE + random() * (MAX_REGION_SIZE - MIN_REGION_SIZE)
  const height =
    MIN_REGION_SIZE + random() * (MAX_REGION_SIZE - MIN_REGION_SIZE)
  const column = sampleIndex % GRID_COLUMNS
  const row = Math.floor(sampleIndex / GRID_COLUMNS) % GRID_ROWS
  const cellWidth = (bounds.maxX - bounds.minX) / GRID_COLUMNS
  const cellHeight = (bounds.maxY - bounds.minY) / GRID_ROWS
  const centerX = bounds.minX + (column + random()) * cellWidth
  const centerY = bounds.minY + (row + random()) * cellHeight
  const minX = centerX - width / 2
  const minY = centerY - height / 2

  return {
    shape: "rect",
    minX,
    maxX: minX + width,
    minY,
    maxY: minY + height,
  }
}

const roundRegion = (region: RerouteRectRegion): RerouteRectRegion => ({
  shape: "rect",
  minX: Number(region.minX.toFixed(3)),
  maxX: Number(region.maxX.toFixed(3)),
  minY: Number(region.minY.toFixed(3)),
  maxY: Number(region.maxY.toFixed(3)),
})

const main = async () => {
  const samples: Array<{
    file: string
    sourceDataset: string
    sourceCircuit: string
    region: RerouteRectRegion
    rippedConnectionCount: number
    retainedTraceCount: number
  }> = []

  await mkdir(OUTPUT_DIR, { recursive: true })

  for (const source of DATASET_SOURCES) {
    const inputSrj = structuredClone(source.getSrj())
    const solver = new AutoroutingPipelineSolver4(inputSrj)
    solver.solve()

    if (!solver.solved || solver.failed) {
      throw new Error(
        `Pipeline4 failed to solve ${source.sourceCircuit}: ${solver.error}`,
      )
    }

    const solvedSrj = solver.getOutputSimpleRouteJson()
    const random = createSeededRandom(source.randomSeed)

    for (
      let sourceSampleIndex = 0;
      sourceSampleIndex < source.sampleCount;
      sourceSampleIndex++
    ) {
      let sampleSrj: SimpleRouteJson | null = null
      let region: RerouteRectRegion | null = null

      for (let attempt = 0; attempt < MAX_REGION_ATTEMPTS; attempt++) {
        const candidateRegion = roundRegion(
          getStratifiedRandomRegion(
            solvedSrj.bounds,
            random,
            sourceSampleIndex,
          ),
        )
        const candidateSrj = getRerouteSimpleRouteJson(
          solvedSrj,
          candidateRegion,
        )

        if (candidateSrj.connections.length === 0) continue

        sampleSrj = candidateSrj
        region = candidateRegion
        break
      }

      const sampleNumber = samples.length + 1

      if (!sampleSrj || !region) {
        throw new Error(
          `Unable to generate sample ${sampleNumber} with ripped routes`,
        )
      }

      const file = `sample${String(sampleNumber).padStart(2, "0")}-region-reroute.srj.json`
      await writeFile(path.join(OUTPUT_DIR, file), stringifyJson(sampleSrj))

      samples.push({
        file,
        sourceDataset: source.sourceDataset,
        sourceCircuit: source.sourceCircuit,
        region,
        rippedConnectionCount: sampleSrj.connections.length,
        retainedTraceCount: sampleSrj.traces?.length ?? 0,
      })
    }
  }

  await writeFile(
    path.join(OUTPUT_DIR, "manifest.json"),
    stringifyJson({
      generatedWith: "AutoroutingPipelineSolver4",
      rerouteMethod: "getRerouteSimpleRouteJson",
      sampleCount: samples.length,
      minRegionSize: MIN_REGION_SIZE,
      maxRegionSize: MAX_REGION_SIZE,
      gridColumns: GRID_COLUMNS,
      gridRows: GRID_ROWS,
      sources: DATASET_SOURCES.map((source) => ({
        sourceDataset: source.sourceDataset,
        sourceCircuit: source.sourceCircuit,
        randomSeed: source.randomSeed,
        sampleCount: source.sampleCount,
      })),
      samples,
    }),
  )

  console.log(
    `Wrote ${samples.length} samples to ${path.relative(process.cwd(), OUTPUT_DIR)}`,
  )
}

await main()
