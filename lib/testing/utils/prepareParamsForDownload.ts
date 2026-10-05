import { sanitizeParamsForDownload } from "./sanitizeParamsForDownload"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)

const looksLikeHgPortPointPathingParams = (
  value: unknown,
): value is Record<string, unknown> => {
  if (!isRecord(value)) return false
  if (!isRecord(value.graph)) return false
  return Array.isArray(value.graph.regions) && Array.isArray(value.connections)
}

const serializeTinyHypergraphPathingParam = (
  param: Record<string, unknown>,
) => {
  const graph = param.graph as Record<string, unknown>
  const regions = Array.isArray(graph.regions) ? graph.regions : []
  const ports = Array.isArray(graph.ports) ? graph.ports : []
  const connections = Array.isArray(param.connections) ? param.connections : []
  const inputSolvedRoutes = Array.isArray(param.inputSolvedRoutes)
    ? param.inputSolvedRoutes
    : []

  return {
    format: "serialized-hg-port-point-pathing-solver-params",
    graph: {
      regions: regions.map((region) => {
        const record = region as Record<string, unknown>
        const regionPorts = Array.isArray(record.ports) ? record.ports : []
        return {
          regionId: record.regionId,
          pointIds: regionPorts
            .map((port) =>
              isRecord(port) && isRecord(port.d) ? port.d.portId : null,
            )
            .filter((portId): portId is string => typeof portId === "string"),
          d: sanitizeParamsForDownload(record.d),
        }
      }),
      ports: ports.map((port) => {
        const record = port as Record<string, unknown>
        const portData = isRecord(record.d) ? { ...record.d } : record.d
        if (isRecord(portData)) {
          delete portData.regions
        }
        return {
          portId: isRecord(record.d) ? record.d.portId : record.portId,
          region1Id: isRecord(record.region1) ? record.region1.regionId : null,
          region2Id: isRecord(record.region2) ? record.region2.regionId : null,
          d: sanitizeParamsForDownload(portData),
        }
      }),
    },
    connections: connections.map((connection) => {
      const record = connection as Record<string, unknown>
      return {
        connectionId: record.connectionId,
        mutuallyConnectedNetworkId: record.mutuallyConnectedNetworkId,
        startRegionId: isRecord(record.startRegion)
          ? record.startRegion.regionId
          : null,
        endRegionId: isRecord(record.endRegion)
          ? record.endRegion.regionId
          : null,
        simpleRouteConnection: sanitizeParamsForDownload(
          record.simpleRouteConnection,
        ),
      }
    }),
    ...(inputSolvedRoutes.length > 0
      ? {
          inputSolvedRoutes: inputSolvedRoutes.map((route) => {
            const record = route as Record<string, unknown>
            const path = Array.isArray(record.path) ? record.path : []
            return {
              connectionId: isRecord(record.connection)
                ? record.connection.connectionId
                : null,
              path: path.map((candidate) => {
                const candidateRecord = candidate as Record<string, unknown>
                return {
                  portId: isRecord(candidateRecord.port)
                    ? candidateRecord.port.portId
                    : null,
                }
              }),
            }
          }),
        }
      : {}),
    ...(param.colorMap !== undefined
      ? { colorMap: sanitizeParamsForDownload(param.colorMap) }
      : {}),
    ...(param.layerCount !== undefined ? { layerCount: param.layerCount } : {}),
    ...(param.effort !== undefined ? { effort: param.effort } : {}),
    ...(param.flags !== undefined
      ? { flags: sanitizeParamsForDownload(param.flags) }
      : {}),
    ...(param.weights !== undefined
      ? { weights: sanitizeParamsForDownload(param.weights) }
      : {}),
    ...(param.opts !== undefined
      ? { opts: sanitizeParamsForDownload(param.opts) }
      : {}),
  }
}

const prepareSingleParamForDownload = (param: unknown) => {
  if (looksLikeHgPortPointPathingParams(param)) {
    return serializeTinyHypergraphPathingParam(param)
  }

  return sanitizeParamsForDownload(param)
}

export const prepareParamsForDownload = (params: unknown) => {
  if (Array.isArray(params)) {
    return params.map((param) => prepareSingleParamForDownload(param))
  }

  return prepareSingleParamForDownload(params)
}
