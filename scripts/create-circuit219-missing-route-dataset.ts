#!/usr/bin/env bun

import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver4 } from "../lib"
import type {
  SimpleRouteConnection,
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "../lib/types"

const OUTPUT_DIR = path.join(process.cwd(), "fixtures/datasets/dataset-srj14")
const SAMPLE_COUNT = 20
const RANDOM_SEED = 219_004

const getCircuit219 = () =>
  (dataset01 as Record<string, unknown>).circuit219 as SimpleRouteJson

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

const getConnectionNameFromTraceId = (trace: SimplifiedPcbTrace) => {
  const match = /^(.*)_\d+$/.exec(trace.pcb_trace_id)
  return match?.[1] ?? trace.connection_name
}

const pickUniqueRandomIndices = (count: number, sampleCount: number) => {
  const indices = Array.from({ length: count }, (_, index) => index)
  const random = createSeededRandom(RANDOM_SEED)

  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const indexAtI = indices[i]!
    indices[i] = indices[j]!
    indices[j] = indexAtI
  }

  return indices.slice(0, sampleCount)
}

const stringifyJson = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

const main = async () => {
  const inputSrj = structuredClone(getCircuit219())
  const solver = new AutoroutingPipelineSolver4(inputSrj)
  solver.solve()

  if (!solver.solved || solver.failed) {
    throw new Error(`Pipeline4 failed to solve circuit219: ${solver.error}`)
  }

  const solvedSrj = solver.getOutputSimpleRouteJson()
  const solvedTraces = solvedSrj.traces ?? []
  const pointPairConnections =
    solver.netToPointPairsSolver?.newConnections ?? []

  if (solvedTraces.length < SAMPLE_COUNT) {
    throw new Error(
      `Expected at least ${SAMPLE_COUNT} traces, got ${solvedTraces.length}`,
    )
  }

  await mkdir(OUTPUT_DIR, { recursive: true })

  const sampleIndices = pickUniqueRandomIndices(
    solvedTraces.length,
    SAMPLE_COUNT,
  )
  const manifest = {
    sourceDataset: "dataset01",
    sourceCircuit: "circuit219",
    generatedWith: "AutoroutingPipelineSolver4",
    randomSeed: RANDOM_SEED,
    sampleCount: SAMPLE_COUNT,
    solvedTraceCount: solvedTraces.length,
    samples: [] as Array<{
      file: string
      removedTraceIndex: number
      removedTraceId: string
      removedConnectionName: string
      pointPairConnectionName: string
    }>,
  }

  for (const [sampleIndex, removedTraceIndex] of sampleIndices.entries()) {
    const removedTrace = solvedTraces[removedTraceIndex]!
    const pointPairConnectionName = getConnectionNameFromTraceId(removedTrace)
    const pointPairConnection = pointPairConnections.find(
      (connection) => connection.name === pointPairConnectionName,
    )

    if (!pointPairConnection) {
      throw new Error(
        `Unable to find point-pair connection for trace ${removedTrace.pcb_trace_id}`,
      )
    }

    const file = `sample${String(sampleIndex + 1).padStart(2, "0")}-${removedTrace.pcb_trace_id}.srj.json`
    const sampleSrj: SimpleRouteJson = {
      ...solvedSrj,
      connections: [
        structuredClone(pointPairConnection as SimpleRouteConnection),
      ],
      traces: solvedTraces.filter((_, index) => index !== removedTraceIndex),
    }

    await writeFile(path.join(OUTPUT_DIR, file), stringifyJson(sampleSrj))

    manifest.samples.push({
      file,
      removedTraceIndex,
      removedTraceId: removedTrace.pcb_trace_id,
      removedConnectionName: removedTrace.connection_name,
      pointPairConnectionName,
    })
  }

  await writeFile(
    path.join(OUTPUT_DIR, "manifest.json"),
    stringifyJson(manifest),
  )

  console.log(
    `Wrote ${SAMPLE_COUNT} samples to ${path.relative(process.cwd(), OUTPUT_DIR)}`,
  )
}

await main()
