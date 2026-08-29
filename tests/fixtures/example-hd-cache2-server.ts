import { AUTOROUTER_VERSION } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/autorouter-version"
import { solvePipeline9NetworkedHighDensityNode } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/solve-pipeline9-networked-high-density-node"
import type {
  Pipeline9NetworkedSolveBatchItem,
  Pipeline9NetworkedSolveBatchRequest,
  Pipeline9NetworkedSolveRequest,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9-networked-types"

export type ExampleHdCache2RequestRecord = {
  pathname: string
  bodyText: string
  bodyBytes: number
  body: unknown
  startedAt: number
  finishedAt?: number
}

type BatchItemMode = "miss" | "solve"

export type ExampleHdCache2ServerOptions = {
  /** Production-faithful default: batch lookup misses, then POST /solve runs. */
  batchItemMode?: BatchItemMode
  beforeSolve?: (
    request: Pipeline9NetworkedSolveRequest,
  ) => void | Promise<void>
  mapSolveEnvelope?: (
    envelope: Record<string, unknown>,
    request: Pipeline9NetworkedSolveRequest,
  ) => unknown | Promise<unknown>
  mapBatchLine?: (
    line: Record<string, unknown>,
    item: Pipeline9NetworkedSolveBatchItem,
    index: number,
  ) => unknown | null | Promise<unknown | null>
}

const jsonResponse = (body: unknown, status = 200): Response =>
  Response.json(body, { status })

/**
 * A real loopback HTTP implementation of the hd-cache2 protocol for tests.
 * It deliberately has no cache: batch lookups miss and /solve executes the
 * exported production node helper from this checkout.
 */
export class ExampleHdCache2Server {
  readonly requests: ExampleHdCache2RequestRecord[] = []
  readonly url: string
  private readonly server: ReturnType<typeof Bun.serve>
  private stopped = false

  constructor(readonly options: ExampleHdCache2ServerOptions = {}) {
    this.server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      idleTimeout: 0,
      fetch: (request) => this.handleRequest(request),
    })
    this.url = `http://127.0.0.1:${this.server.port}`
  }

  get solveRequests(): ExampleHdCache2RequestRecord[] {
    return this.requests.filter(({ pathname }) => pathname === "/solve")
  }

  get batchRequests(): ExampleHdCache2RequestRecord[] {
    return this.requests.filter(({ pathname }) => pathname === "/solve-batch")
  }

  async close(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    await this.server.stop(true)
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }

  private async handleRequest(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname
    const startedAt = performance.now()
    const bodyText = request.method === "GET" ? "" : await request.text()
    let body: unknown = null
    if (bodyText) {
      try {
        body = JSON.parse(bodyText)
      } catch {
        return jsonResponse({ ok: false, message: "Invalid JSON" }, 400)
      }
    }
    const record: ExampleHdCache2RequestRecord = {
      pathname,
      bodyText,
      bodyBytes: new TextEncoder().encode(bodyText).byteLength,
      body,
      startedAt,
    }
    this.requests.push(record)

    try {
      return await this.handleProtocolRequest(request, pathname, body)
    } finally {
      record.finishedAt = performance.now()
    }
  }

  private async handleProtocolRequest(
    request: Request,
    pathname: string,
    body: unknown,
  ): Promise<Response> {
    if (request.method === "GET" && pathname === "/health") {
      return jsonResponse({
        ok: true,
        autorouterVersion: AUTOROUTER_VERSION,
        benchmarkCacheVersionSupported: true,
        benchmarkCacheVersionAccess: "open",
      })
    }
    if (request.method !== "POST") {
      return jsonResponse({ ok: false, message: "Not found" }, 404)
    }
    if (pathname === "/solve") {
      return this.handleSolve(body as Pipeline9NetworkedSolveRequest)
    }
    if (pathname === "/solve-batch") {
      return this.handleBatch(body as Pipeline9NetworkedSolveBatchRequest)
    }
    return jsonResponse({ ok: false, message: "Not found" }, 404)
  }

  private validateVersion(value: unknown): Response | null {
    if (value === AUTOROUTER_VERSION) return null
    return jsonResponse(
      {
        ok: false,
        autorouterVersion: AUTOROUTER_VERSION,
        message: `Expected autorouter version ${AUTOROUTER_VERSION}`,
      },
      409,
    )
  }

  private async handleSolve(
    solveRequest: Pipeline9NetworkedSolveRequest,
  ): Promise<Response> {
    const versionError = this.validateVersion(solveRequest?.autorouterVersion)
    if (versionError) return versionError
    if (!solveRequest?.input) {
      return jsonResponse({ ok: false, message: "Missing input" }, 400)
    }

    try {
      await this.options.beforeSolve?.(solveRequest)
      const output = solvePipeline9NetworkedHighDensityNode(solveRequest.input)
      const envelope: Record<string, unknown> = {
        ok: true,
        autorouterVersion: AUTOROUTER_VERSION,
        ...(solveRequest.cacheVersion === undefined
          ? {}
          : { cacheVersion: solveRequest.cacheVersion }),
        source: "solver",
        ...output,
      }
      const responseBody = this.options.mapSolveEnvelope
        ? await this.options.mapSolveEnvelope(envelope, solveRequest)
        : envelope
      return jsonResponse(responseBody)
    } catch (error) {
      return jsonResponse(
        {
          ok: false,
          autorouterVersion: AUTOROUTER_VERSION,
          message: error instanceof Error ? error.message : String(error),
        },
        500,
      )
    }
  }

  private async handleBatch(
    batchRequest: Pipeline9NetworkedSolveBatchRequest,
  ): Promise<Response> {
    const versionError = this.validateVersion(batchRequest?.autorouterVersion)
    if (versionError) return versionError
    if (!Array.isArray(batchRequest?.items)) {
      return jsonResponse({ ok: false, message: "Missing batch items" }, 400)
    }

    const lines: string[] = []
    for (const [index, item] of batchRequest.items.entries()) {
      const mode = this.options.batchItemMode ?? "miss"
      let line: Record<string, unknown>
      if (mode === "solve") {
        await this.options.beforeSolve?.({
          autorouterVersion: batchRequest.autorouterVersion,
          ...(batchRequest.cacheVersion === undefined
            ? {}
            : { cacheVersion: batchRequest.cacheVersion }),
          input: item.input,
        })
        line = {
          requestId: item.requestId,
          ok: true,
          autorouterVersion: AUTOROUTER_VERSION,
          ...(batchRequest.cacheVersion === undefined
            ? {}
            : { cacheVersion: batchRequest.cacheVersion }),
          source: "solver",
          ...solvePipeline9NetworkedHighDensityNode(item.input),
        }
      } else {
        line = {
          requestId: item.requestId,
          ok: false,
          autorouterVersion: AUTOROUTER_VERSION,
          ...(batchRequest.cacheVersion === undefined
            ? {}
            : { cacheVersion: batchRequest.cacheVersion }),
          code: "CACHE_MISS",
          message: "ExampleHdCache2Server does not cache results",
        }
      }
      const mappedLine = this.options.mapBatchLine
        ? await this.options.mapBatchLine(line, item, index)
        : line
      if (mappedLine !== null) lines.push(JSON.stringify(mappedLine))
    }

    return new Response(lines.length === 0 ? "" : `${lines.join("\n")}\n`, {
      headers: { "content-type": "application/x-ndjson" },
    })
  }
}
