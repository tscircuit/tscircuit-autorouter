import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { instrumentTinyHypergraph } from "../scripts/astar-recording/instrumentTinyHypergraph"

type RecordedEvent = {
  sequence: number
  type: string
  solverId: number
  attempt: number
  candidate?: { id: number; parentId: number | null }
  parentCandidateId?: number
  neighborPortIds?: number[]
  portId?: number
  outcome?: string
}

test("records every visited A* neighbor with linked candidates without changing Pipeline 9 e2e3 routes", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "astar-recording-"))
  try {
    for (const name of ["recorded", "baseline", "compact"]) {
      const result = Bun.spawnSync(
        [
          process.execPath,
          "scripts/record-port-point-search.ts",
          "--pipeline",
          "9",
          "--out-dir",
          path.join(directory, name),
          "--full-run",
          ...(name === "baseline" ? ["--no-record"] : []),
          ...(name === "compact" ? ["--events-jsonl-only"] : []),
        ],
        {
          cwd: path.resolve(import.meta.dir, ".."),
          stdout: "pipe",
          stderr: "pipe",
        },
      )
      expect(result.stderr.toString()).toBe("")
      expect(result.exitCode).toBe(0)
    }
    const recordedDir = path.join(directory, "recorded")
    for (const name of ["port-point-output.json", "output.srj.json"]) {
      expect(readFileSync(path.join(recordedDir, name), "utf8")).toBe(
        readFileSync(path.join(directory, "baseline", name), "utf8"),
      )
    }
    const searchDir = path.join(recordedDir, "search")
    const events: RecordedEvent[] = readFileSync(
      path.join(searchDir, "events.jsonl"),
      "utf8",
    )
      .trim()
      .split("\n")
      .map((line: string): RecordedEvent => JSON.parse(line))
    expect(
      readFileSync(
        path.join(directory, "compact", "search", "events.jsonl"),
        "utf8",
      ),
    ).toBe(readFileSync(path.join(searchDir, "events.jsonl"), "utf8"))
    expect(
      existsSync(path.join(directory, "compact", "search", "events")),
    ).toBe(false)
    const manifest = JSON.parse(
      readFileSync(path.join(searchDir, "manifest.json"), "utf8"),
    )
    expect(manifest.status).toBe("complete")
    expect(manifest.eventCount).toBe(events.length)
    expect(manifest.counts.expansion).toBeGreaterThan(0)
    const candidates = new Set<number>()
    const expansions = new Map<
      number,
      { ports: number[]; visited: number[]; lastOutcome?: string }
    >()
    for (const [index, event] of events.entries()) {
      expect(event.sequence).toBe(index + 1)
      const miniPath = path.join(
        searchDir,
        "events",
        String(Math.floor(index / 1000)).padStart(6, "0"),
        `${String(event.sequence).padStart(9, "0")}.json`,
      )
      expect(JSON.parse(readFileSync(miniPath, "utf8"))).toEqual(event)
      if (event.candidate) {
        if (event.candidate.parentId !== null)
          expect(candidates.has(event.candidate.parentId)).toBe(true)
        candidates.add(event.candidate.id)
      }
      if (event.type === "expansion")
        expansions.set(event.candidate!.id, {
          ports: event.neighborPortIds!,
          visited: [],
        })
      if (event.type === "neighbor") {
        const expansion = expansions.get(event.parentCandidateId!)!
        expect(expansion).toBeDefined()
        expansion.visited.push(event.portId!)
        expansion.lastOutcome = event.outcome
        expect(event.outcome).not.toBe("exception")
      }
    }
    for (const expansion of expansions.values()) {
      expect(expansion.visited).toEqual(
        expansion.ports.slice(0, expansion.visited.length),
      )
      if (expansion.visited.length < expansion.ports.length)
        expect(expansion.lastOutcome).toBe("goal-contact")
    }
    expect(candidates.size).toBe(manifest.candidateCount)
    expect(() =>
      instrumentTinyHypergraph("changed upstream source", "/unused"),
    ).toThrow("does not recognize")
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
