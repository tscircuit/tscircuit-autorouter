import { expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  createSameMachineBenchmarkPlan,
  runSameMachineBenchmarks,
} from "../scripts/benchmark/runSameMachineBenchmarks"

test("same-machine comparisons execute four fresh passes only for threaded requests", (): void => {
  const directory = mkdtempSync(join(tmpdir(), "benchmark-four-passes-"))
  const args = ["--dataset", "18", "--effort", "0.5", "--threads", "4"]
  try {
    for (const revision of ["base", "pr"]) {
      const cwd = join(directory, `same-machine-${revision}`)
      mkdirSync(cwd)
      writeFileSync(
        join(cwd, "benchmark.sh"),
        [
          "#!/bin/bash",
          "set -eu",
          `printf '${revision}|%s|%s\\n' "$*" "\${HD_CACHE2_CACHE_VERSION-}" >> ../passes.log`,
          "if [ -f ../fail ] && [[ \"$*\" == *'--threads 4'* ]]; then",
          "  echo '{\"interrupted\":true}' > benchmark-interrupted.json",
          "  exit 7",
          "fi",
          `printf '${revision} %s' "$*" > benchmark-result.json`,
          "cp benchmark-result.json benchmark-result.txt",
          "cp benchmark-result.json benchmark-snapshots.html",
          "if [ -f ../missing ] && [[ \"$*\" == *'--threads 4'* ]]; then",
          "  rm benchmark-result.json",
          "fi",
          "",
        ].join("\n"),
      )
    }
    const plan = runSameMachineBenchmarks(directory, args, "18")
    expect(plan.threads).toBe(4)
    expect(readFileSync(join(directory, "passes.log"), "utf8")).toBe(
      [
        "base|--dataset 18 --effort 0.5 --threads 1|",
        "pr|--dataset 18 --effort 0.5 --threads 1|",
        "base|--dataset 18 --effort 0.5 --threads 4|",
        "pr|--dataset 18 --effort 0.5 --threads 4|",
        "",
      ].join("\n"),
    )
    for (const { output, revision, args: passArgs } of plan.passes) {
      const report = readFileSync(
        join(
          directory,
          "same-machine-results",
          output,
          "benchmark-result.json",
        ),
        "utf8",
      )
      expect(report).toBe(`${revision} ${passArgs.join(" ")}`)
    }
    for (const inlineArgs of [[], ["--threads", "1"]]) {
      const inline = createSameMachineBenchmarkPlan(inlineArgs, "srj18")
      expect(inline.threads).toBeUndefined()
      expect(inline.passes.map((pass) => pass.output)).toEqual(["base", "pr"])
      expect(inline.passes[0]!.args).toContain("srj18")
    }
    for (const invalid of ["0", "-1", "1.5", "wat", ""]) {
      expect(() =>
        createSameMachineBenchmarkPlan(["--threads", invalid], "srj18"),
      ).toThrow("positive integer")
    }
    const repeated = createSameMachineBenchmarkPlan(
      ["--threads", "2", "--effort", "1", "--threads", "8"],
      "srj18",
    )
    expect(repeated.threads).toBe(8)
    expect(repeated.passes[2]!.args).toEqual([
      "--effort",
      "1",
      "--dataset",
      "srj18",
      "--threads",
      "8",
    ])

    rmSync(join(directory, "passes.log"))
    runSameMachineBenchmarks(directory, ["--networked-remote"], "srj18")
    const remotePasses = readFileSync(join(directory, "passes.log"), "utf8")
      .trim()
      .split("\n")
    expect(remotePasses).toHaveLength(2)
    expect(remotePasses[0]).toContain("benchmark-")
    expect(remotePasses[1]).toContain("benchmark-")
    expect(remotePasses[0]!.split("|")[2]).not.toBe(
      remotePasses[1]!.split("|")[2],
    )

    rmSync(join(directory, "passes.log"))
    writeFileSync(join(directory, "fail"), "")
    expect(() => runSameMachineBenchmarks(directory, args, "18")).toThrow(
      "Benchmark base-threaded failed (7)",
    )
    expect(
      existsSync(join(directory, "same-machine-results", "pr-threaded")),
    ).toBe(false)
    expect(
      readFileSync(join(directory, "passes.log"), "utf8").trim().split("\n"),
    ).toHaveLength(3)
    expect(
      existsSync(
        join(
          directory,
          "same-machine-results",
          "base-threaded",
          "benchmark-interrupted.json",
        ),
      ),
    ).toBe(true)
    rmSync(join(directory, "fail"))
    writeFileSync(join(directory, "missing"), "")
    expect(() => runSameMachineBenchmarks(directory, args, "18")).toThrow()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
