import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { SimpleRouteJson } from "../../lib/types"
import { addBoardCongestion } from "./addBoardCongestion"
import { createUsbBoard } from "./createUsbBoard"
import { mutateBoard } from "./mutateBoard"
import type { CorpusKind, CorpusOptions, CorpusSample, CorpusSplit } from "./types"

type SourceFamily = {
  familyId: string
  split: CorpusSplit
  sourcePath: string
  pairCount?: number
}

// All variants of the same procedural USB template stay in one split.
export const sourceFamilies: readonly SourceFamily[] = [
  { familyId: "usb_c_series_template", split: "train", sourcePath: "synthetic:usb_c_series_resistors_v2", pairCount: 1 },
  { familyId: "usb_c_series_template", split: "train", sourcePath: "synthetic:usb_c_series_resistors_v2", pairCount: 2 },
  { familyId: "usb_c_series_template", split: "train", sourcePath: "synthetic:usb_c_series_resistors_v2", pairCount: 3 },
  { familyId: "core_pad_clearance", split: "validation", sourcePath: "tests/fixtures/core-differential-pair-pad-clearance.json" },
  { familyId: "pico_usb_bug85", split: "test", sourcePath: "fixtures/bug-reports/bugreport85-pico-usb-differential-pair/bugreport85-pico-usb-differential-pair.srj.json" },
]

export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0
  return (): number => {
    state += 0x6d2b79f5
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

/** Deterministic input generation only: no autorouter or solve-rate claims. */
export function generateCorpus(options: CorpusOptions): CorpusSample[] {
  if (!Number.isInteger(options.count) || options.count < 1 || options.count > 100_000) {
    throw new Error("Corpus count must be an integer between 1 and 100000")
  }
  if (!Number.isInteger(options.seed) || options.seed < 0 || options.seed > 0xffffffff) {
    throw new Error("Corpus seed must be an unsigned 32-bit integer")
  }
  const samples: CorpusSample[] = []
  const fingerprints = new Set<string>()
  const sources = new Map<string, string>()
  for (const family of sourceFamilies) {
    sources.set(family.sourcePath, family.pairCount === undefined
      ? readFileSync(resolve(options.sourceRoot, family.sourcePath), "utf8")
      : readFileSync(new URL("./createUsbBoard.ts", import.meta.url), "utf8"))
  }
  for (let index = 0; index < options.count; index++) {
    const family = sourceFamilies[index % sourceFamilies.length]!
    const variantIndex = Math.floor(index / sourceFamilies.length)
    const sampleSeed = (options.seed + Math.imul(index + 1, 0x9e3779b1)) >>> 0
    const random = createSeededRandom(sampleSeed)
    const kind: CorpusKind = family.pairCount === undefined ? "stress" :
      variantIndex % 16 === 15 ? "infeasible" : variantIndex % 4 === 0 ? "control" : "stress"
    const sourceText = sources.get(family.sourcePath)!
    const sourceSha256 = createHash("sha256").update(sourceText).digest("hex")
    const board = family.pairCount === undefined ? {
      srj: JSON.parse(sourceText) as SimpleRouteJson,
      logicalPaths: [], controlWitness: undefined,
    } : createUsbBoard({
      pairCount: family.pairCount, random, kind,
      layerCount: variantIndex % 2 === 0 ? 2 : 4,
    })
    if ((board.srj.differentialPairs?.length ?? 0) === 0) {
      throw new Error(`Source family ${family.familyId} has no declared differential pair`)
    }
    if (family.pairCount === undefined) {
      // Pico exports four-layer through-hole masks on a two-layer board. Restrict
      // those masks to physically present layers; copper on top/bottom is unchanged.
      if (board.srj.layerCount === 2) {
        for (const obstacle of board.srj.obstacles) {
          if (obstacle.layers.join(",") === "top,inner1,inner2,bottom") {
            obstacle.layers = ["top", "bottom"]
          }
        }
      }
      addBoardCongestion({ srj: board.srj, random, count: 1 + variantIndex % 12 })
    }
    // Compute before global transforms: orientation/translation/scaling are not independent boards.
    const fingerprint = createHash("sha256").update(JSON.stringify(board.srj)).digest("hex")
    if (fingerprints.has(fingerprint)) throw new Error(`Duplicate pre-transform board at index ${index}`)
    fingerprints.add(fingerprint)
    const mutation = {
      scaleFactor: Math.round((0.9 + random() * 0.4) * 1000) / 1000,
      quarterTurns: Math.floor(random() * 4),
      reflected: random() > 0.5,
      translateX: Math.round((random() - 0.5) * 20 * 100) / 100,
      translateY: Math.round((random() - 0.5) * 20 * 100) / 100,
    }
    const srj = mutateBoard(board.srj, mutation)
    const controlWitness = board.controlWitness === undefined ? undefined :
      mutateBoard({ ...board.srj, traces: board.controlWitness }, mutation).traces
    samples.push({
      sampleId: `${family.familyId}${family.pairCount === undefined ? "" : `_p${family.pairCount}`}_s${options.seed.toString(16)}_${variantIndex.toString().padStart(5, "0")}`,
      srj,
      provenance: {
        familyId: family.familyId, split: family.split,
        sourcePath: family.sourcePath, sourceSha256, seed: sampleSeed,
        mutation: { ...mutation, variantIndex, generatorVersion: 2,
          normalizeThroughHoleLayerMask: family.familyId === "pico_usb_bug85",
          addedKeepouts: family.pairCount === undefined ? 1 + variantIndex % 12 : 0,
          ...(family.pairCount === undefined ? {} : { pairCount: family.pairCount }),
        },
      },
      kind, fingerprint, logicalPaths: board.logicalPaths, controlWitness,
    })
  }
  return samples
}
