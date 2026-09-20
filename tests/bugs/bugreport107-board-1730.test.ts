import { expect, test } from "bun:test"

// Run in a separate process because synchronous solver work can block Bun's
// test timeout and prevent a deadline check between solver steps.
test("bugreport107 Pipeline9 exceeds the five-minute solve deadline", async (): Promise<void> => {
  const maxSolveTimeMs = 300_000
  let timedOut = false
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `
        import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
        import bugReport from "./fixtures/bug-reports/bugreport107-board-1730/bugreport107-board-1730.json"
        const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
          structuredClone(bugReport.simple_route_json),
        )
        solver.solve()
        console.log(JSON.stringify({
          solved: solver.solved,
          failed: solver.failed,
          error: solver.error,
        }))
      `,
    ],
    {
      cwd: new URL("../../", import.meta.url).pathname,
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const deadline = setTimeout(() => {
    timedOut = true
    child.kill("SIGKILL")
  }, maxSolveTimeMs)

  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(timedOut, `Solver exited before deadline: ${stdout}\n${stderr}`).toBe(true)
    expect(exitCode).not.toBe(0)
    expect(child.signalCode).toBe("SIGKILL")
    // A killed process cannot report a final solver.failed/solver.solved state.
    expect(stdout).not.toContain('"solved":true')
  } finally {
    clearTimeout(deadline)
    if (child.exitCode === null) child.kill("SIGKILL")
  }
}, 310_000)
