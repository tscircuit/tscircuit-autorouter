import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { createInterface, type Interface } from "node:readline"
import { fileURLToPath } from "node:url"
import {
  getLocalHighDensityServerIndex,
  parseLocalHighDensityRequest,
  type LocalHighDensityBatchRequest,
  type LocalHighDensityRequest,
  type LocalHighDensityServerStats,
} from "./localHighDensityProtocol"

type LocalHighDensityChild = {
  child: ChildProcessWithoutNullStreams
  cpuId: number
  url: string | null
  stdout: Interface
  stderr: string
}
export type LocalHighDensityClusterStats = {
  servers: Array<{
    pid: number
    cpuId: number
    stats: LocalHighDensityServerStats
  }>
}
export type LocalHighDensityCluster = {
  url: string
  serverPids: number[]
  fault: Promise<never>
  assertHealthy: () => void
  getStats: () => Promise<LocalHighDensityClusterStats>
  stop: () => Promise<void>
}
export type LocalHighDensityClusterOptions = {
  autorouterVersion: string
  serverCpuIds: number[]
  checkoutDirectory?: string
  startupTimeoutMs?: number
  signal?: AbortSignal
}

/** Eight pinned HTTP processes per lane; the parent only forwards protocol data. */
export async function startLocalHighDensityCluster(
  options: LocalHighDensityClusterOptions,
): Promise<LocalHighDensityCluster> {
  options.signal?.throwIfAborted()
  if (
    options.serverCpuIds.length !== 8 ||
    new Set(options.serverCpuIds).size !== 8 ||
    options.serverCpuIds.some(
      (cpuId) => !Number.isSafeInteger(cpuId) || cpuId < 0,
    )
  ) {
    throw new Error(
      "Local high-density cluster requires eight distinct CPU IDs",
    )
  }
  const checkoutDirectory =
    options.checkoutDirectory ??
    fileURLToPath(new URL("../../", import.meta.url))
  const entrypoint = resolve(
    checkoutDirectory,
    "scripts/benchmark/localHighDensityServerProcess.ts",
  )
  if (!existsSync(entrypoint))
    throw new Error(
      `Local high-density server entrypoint is absent in checkout ${checkoutDirectory}`,
    )
  const children: LocalHighDensityChild[] = []
  let gateway: ReturnType<typeof Bun.serve> | null = null
  let faultError: Error | null = null
  let stopping = false
  let stopPromise: Promise<void> | null = null
  let rejectFault!: (error: Error) => void
  const fault = new Promise<never>((_resolve, reject): void => {
    rejectFault = reject
  })
  void fault.catch((): void => {
    /* The original promise remains rejected for the caller's task race. */
  })
  const assertHealthy = (): void => {
    if (faultError !== null) throw faultError
    if (stopping) throw new Error("Local high-density cluster has stopped")
    for (const entry of children) {
      if (entry.child.exitCode !== null || entry.child.signalCode !== null) {
        throw new Error(
          `Local high-density server ${entry.child.pid} is no longer running`,
        )
      }
    }
  }
  const terminateOnExit = (): void => {
    for (const entry of children) {
      if (entry.child.exitCode === null && entry.child.signalCode === null) {
        entry.child.kill("SIGKILL")
      }
    }
  }
  const stop = (): Promise<void> => {
    if (stopPromise !== null) return stopPromise
    stopping = true
    gateway?.stop(true)
    stopPromise = Promise.all(
      children.map(
        (entry): Promise<void> =>
          new Promise((done): void => {
            if (
              entry.child.exitCode !== null ||
              entry.child.signalCode !== null
            ) {
              done()
              return
            }
            const timer = setTimeout((): void => {
              entry.child.kill("SIGKILL")
            }, 5_000)
            entry.child.once("close", (): void => {
              clearTimeout(timer)
              done()
            })
            entry.child.kill("SIGTERM")
          }),
      ),
    ).then((): void => {
      for (const entry of children) entry.stdout.close()
      process.off("exit", terminateOnExit)
      options.signal?.removeEventListener("abort", abortStartup)
    })
    return stopPromise
  }
  const reportFault = (error: unknown): Error => {
    const failure = error instanceof Error ? error : new Error(String(error))
    if (!stopping && faultError === null) {
      faultError = failure
      rejectFault(failure)
      void stop()
    }
    return failure
  }
  const abortStartup = (): void => {
    const reason = options.signal?.reason
    const failure =
      reason === undefined || reason === null
        ? new Error("Local high-density cluster startup aborted")
        : reason
    reportFault(failure)
  }
  options.signal?.addEventListener("abort", abortStartup, { once: true })
  process.once("exit", terminateOnExit)
  const startupTimer = setTimeout((): void => {
    reportFault(new Error("Local high-density cluster startup timed out"))
  }, options.startupTimeoutMs ?? 30_000)
  try {
    const ready = options.serverCpuIds.map((cpuId): Promise<void> => {
      const child = spawn(
        "taskset",
        [
          "-c",
          String(cpuId),
          process.execPath,
          entrypoint,
          options.autorouterVersion,
        ],
        {
          cwd: checkoutDirectory,
          env: process.env,
          stdio: ["pipe", "pipe", "pipe"],
        },
      )
      const entry: LocalHighDensityChild = {
        child,
        cpuId,
        url: null,
        stdout: createInterface({ input: child.stdout }),
        stderr: "",
      }
      children.push(entry)
      child.stderr.on("data", (chunk: Buffer): void => {
        entry.stderr = (entry.stderr + chunk.toString()).slice(-8192)
      })
      child.once("error", (error: Error): void => {
        reportFault(error)
      })
      child.once("exit", (code, signal): void => {
        if (!stopping)
          reportFault(
            new Error(
              `Local high-density server ${child.pid} exited (${code ?? signal}): ${entry.stderr}`,
            ),
          )
      })
      return new Promise((resolveReady): void => {
        entry.stdout.on("line", (line: string): void => {
          if (!line.startsWith("LOCAL_HD_READY ")) return
          try {
            const value = JSON.parse(line.slice("LOCAL_HD_READY ".length)) as {
              pid?: number
              url?: string
              autorouterVersion?: string
            }
            if (
              entry.url !== null ||
              value.pid !== child.pid ||
              value.autorouterVersion !== options.autorouterVersion ||
              typeof value.url !== "string" ||
              !/^http:\/\/127\.0\.0\.1:\d+$/.test(value.url)
            ) {
              throw new Error(
                "Local high-density server sent invalid readiness metadata",
              )
            }
            entry.url = value.url
            resolveReady()
          } catch (error) {
            reportFault(error)
          }
        })
      })
    })
    await Promise.race([Promise.all(ready), fault])
    clearTimeout(startupTimer)
    const serverUrl = (index: number): string => {
      assertHealthy()
      const entry = children[index]
      if (!entry || entry.url === null) {
        throw new Error("Local high-density server has no ready URL")
      }
      return entry.url
    }
    const getStats = async (): Promise<LocalHighDensityClusterStats> => {
      const servers = await Promise.all(
        children.map(
          async (
            entry,
            index,
          ): Promise<LocalHighDensityClusterStats["servers"][number]> => {
            const response = await fetch(`${serverUrl(index)}/stats`)
            if (!response.ok)
              throw reportFault(
                new Error("Local high-density stats request failed"),
              )
            return {
              pid: entry.child.pid!,
              cpuId: entry.cpuId,
              stats: (await response.json()) as LocalHighDensityServerStats,
            }
          },
        ),
      )
      assertHealthy()
      return { servers }
    }
    gateway = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request: Request): Promise<Response> => {
        const pathname = new URL(request.url).pathname
        if (request.method === "GET" && pathname === "/stats")
          return Response.json(await getStats())
        if (
          request.method !== "POST" ||
          !["/solve", "/solve-batch"].includes(pathname)
        ) {
          return Response.json(
            { ok: false, message: "Unknown local cluster endpoint" },
            { status: 404 },
          )
        }
        let solveRequest: LocalHighDensityRequest | null = null
        let batchRequest: LocalHighDensityBatchRequest | null = null
        try {
          const body: unknown = await request.json()
          if (pathname === "/solve")
            solveRequest = parseLocalHighDensityRequest(
              body,
              options.autorouterVersion,
              false,
            )
          else
            batchRequest = parseLocalHighDensityRequest(
              body,
              options.autorouterVersion,
              true,
            )
        } catch (error) {
          return Response.json(
            {
              ok: false,
              message: error instanceof Error ? error.message : String(error),
            },
            { status: 400 },
          )
        }
        try {
          assertHealthy()
          if (solveRequest !== null) {
            const index = getLocalHighDensityServerIndex(
              solveRequest,
              children.length,
            )
            const response = await fetch(`${serverUrl(index)}/solve`, {
              method: "POST",
              body: JSON.stringify(solveRequest),
              headers: { "content-type": "application/json" },
            })
            if (!response.ok)
              throw new Error(
                `Local high-density server solve failed (${response.status}): ${await response.text()}`,
              )
            const output = (await response.json()) as Record<string, unknown>
            if (
              output.ok !== true ||
              output.autorouterVersion !== solveRequest.autorouterVersion ||
              output.cacheVersion !== solveRequest.cacheVersion
            ) {
              throw new Error(
                "Local high-density server returned mismatched solve identity",
              )
            }
            assertHealthy()
            return Response.json(output)
          }
          if (batchRequest === null)
            throw new Error("Local high-density gateway has no parsed request")
          const batch = batchRequest
          const grouped = new Map<
            number,
            LocalHighDensityBatchRequest["items"]
          >()
          for (const item of batch.items) {
            const index = getLocalHighDensityServerIndex(
              { ...batch, input: item.input },
              children.length,
            )
            const items = grouped.get(index) ?? []
            items.push(item)
            grouped.set(index, items)
          }
          const byRequestId = new Map<string, Record<string, unknown>>()
          await Promise.all(
            [...grouped].map(async ([index, items]): Promise<void> => {
              const response = await fetch(`${serverUrl(index)}/solve-batch`, {
                method: "POST",
                body: JSON.stringify({ ...batch, items }),
                headers: { "content-type": "application/json" },
              })
              if (!response.ok)
                throw new Error(
                  `Local high-density cache lookup failed (${response.status})`,
                )
              const lines = (await response.text())
                .split("\n")
                .filter((line) => line.length > 0)
              if (lines.length !== items.length)
                throw new Error(
                  "Local high-density batch returned an incorrect line count",
                )
              for (const [itemIndex, line] of lines.entries()) {
                const result = JSON.parse(line) as Record<string, unknown>
                if (
                  result.requestId !== items[itemIndex].requestId ||
                  result.autorouterVersion !== batch.autorouterVersion ||
                  result.cacheVersion !== batch.cacheVersion ||
                  !(
                    (result.ok === true && result.source === "cache") ||
                    (result.ok === false && result.code === "CACHE_MISS")
                  )
                ) {
                  throw new Error(
                    "Local high-density batch returned invalid ordering, identity, or cache status",
                  )
                }
                byRequestId.set(items[itemIndex].requestId, result)
              }
            }),
          )
          assertHealthy()
          return new Response(
            batch.items
              .map((item) => JSON.stringify(byRequestId.get(item.requestId)))
              .join("\n") + (batch.items.length ? "\n" : ""),
            {
              headers: { "content-type": "application/x-ndjson" },
            },
          )
        } catch (error) {
          const failure = reportFault(error)
          return Response.json(
            { ok: false, message: failure.message },
            { status: 500 },
          )
        }
      },
    })
    return {
      url: `http://127.0.0.1:${gateway.port}`,
      serverPids: children.map((entry) => entry.child.pid!),
      fault,
      assertHealthy,
      getStats,
      stop,
    }
  } catch (error) {
    clearTimeout(startupTimer)
    await stop()
    throw error
  }
}
