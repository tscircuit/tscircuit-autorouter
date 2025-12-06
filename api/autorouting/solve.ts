import type { VercelRequest, VercelResponse } from "@vercel/node"
import { CapacityMeshSolver } from "../../lib/solvers/AutoroutingPipelineSolver"
import type { SimpleRouteJson } from "../../lib/types"

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
) {
  // Only allow POST requests
  if (request.method !== "POST") {
    return response.status(405).json({ error: "Method not allowed" })
  }

  try {
    const { input_simple_route_json } = request.body

    if (!input_simple_route_json) {
      return response.status(400).json({
        error: "Missing input_simple_route_json in request body",
      })
    }

    // Validate the input has required fields
    if (!validateSimpleRouteJson(input_simple_route_json)) {
      return response.status(400).json({
        error: "Invalid input_simple_route_json format",
      })
    }

    // Create solver instance
    const solver = new CapacityMeshSolver(
      input_simple_route_json as SimpleRouteJson,
      {
        capacityDepth: 6, // Configurable parameter for mesh granularity
      },
    )

    // Solve the routing problem
    solver.solve()

    // If solver failed to find a solution
    if (solver.error) {
      return response.status(400).json({
        error: `Failed to solve routing: ${solver.error}`,
      })
    }

    // Convert solver output to simplified trace format
    const traces = solver.getOutputSimplifiedPcbTraces()

    // Return the solution
    const output_simple_route_json = {
      ...input_simple_route_json,
      traces,
    }

    return response.status(200).json({
      output_simple_route_json,
    })
  } catch (error) {
    console.error("Error in autorouting solve endpoint:", error)
    return response.status(500).json({
      error: "Internal server error",
    })
  }
}

function validateSimpleRouteJson(input: any): boolean {
  return (
    input &&
    typeof input === "object" &&
    typeof input.layerCount === "number" &&
    typeof input.minTraceWidth === "number" &&
    Array.isArray(input.obstacles) &&
    Array.isArray(input.connections) &&
    input.bounds &&
    typeof input.bounds.minX === "number" &&
    typeof input.bounds.maxX === "number" &&
    typeof input.bounds.minY === "number" &&
    typeof input.bounds.maxY === "number"
  )
}
