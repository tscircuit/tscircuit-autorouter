import type { ConnectivityMap } from "circuit-json-to-connectivity-map";
import { isObstacleConnectedToRoute } from "lib/solvers/TraceWidthSolver/isObstacleConnectedToRoute";
import type {
  Obstacle,
  SimpleRouteConnection,
  SimplifiedPcbTraces,
} from "lib/types";
import type { HighDensityRoute } from "lib/types/high-density-types";
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute";

export interface ConvertPipeline7HdRoutesOptions {
  connections: SimpleRouteConnection[];
  originalConnections: SimpleRouteConnection[];
  hdRoutes: HighDensityRoute[];
  layerCount: number;
  obstacles: Obstacle[];
  defaultViaHoleDiameter: number;
  connMap: ConnectivityMap;
}

type StaticConvertPipeline7HdRoutesOptions = Omit<
  ConvertPipeline7HdRoutesOptions,
  "hdRoutes"
>;

type PreparedConnection = {
  connection: SimpleRouteConnection;
  connectsTo: string[];
  outputConnectionName: string;
};

export const createPipeline7HdRoutesToSimplifiedPcbTracesConverter = ({
  connections,
  originalConnections,
  layerCount,
  obstacles,
  defaultViaHoleDiameter,
  connMap,
}: StaticConvertPipeline7HdRoutesOptions) => {
  const netConnectionNameByOriginalConnectionName = new Map<
    string,
    string | undefined
  >();
  for (const connection of originalConnections) {
    if (!netConnectionNameByOriginalConnectionName.has(connection.name)) {
      netConnectionNameByOriginalConnectionName.set(
        connection.name,
        connection.__netConnectionName,
      );
    }
  }

  const preparedConnections: PreparedConnection[] = connections.map(
    (connection) => {
      if (connection.pointsToConnect.length !== 2) {
        throw new Error(
          `Expected Pipeline7 output connection "${connection.name}" to have two points, got ${connection.pointsToConnect.length}`,
        );
      }

      const [startPoint, endPoint] = connection.pointsToConnect;
      return {
        connection,
        connectsTo: [startPoint?.pointId, endPoint?.pointId].filter(
          (pointId): pointId is string => Boolean(pointId),
        ),
        outputConnectionName:
          connection.__netConnectionName ??
          netConnectionNameByOriginalConnectionName.get(connection.name) ??
          connection.__rootConnectionNames?.[0] ??
          connection.name,
      };
    },
  );

  const multilayerObstacles = obstacles.filter(
    (obstacle) =>
      (obstacle.__zLayers?.length ?? obstacle.layers?.length ?? 0) > 1,
  );
  const connectedObstaclesByConnectionName = new Map<
    string,
    Map<string | undefined, ReadonlyArray<Obstacle>>
  >();
  const getConnectedMultilayerObstacles = (route: HighDensityRoute) => {
    let byRootConnectionName = connectedObstaclesByConnectionName.get(
      route.connectionName,
    );
    if (!byRootConnectionName) {
      byRootConnectionName = new Map();
      connectedObstaclesByConnectionName.set(
        route.connectionName,
        byRootConnectionName,
      );
    }
    const cached = byRootConnectionName.get(route.rootConnectionName);
    if (cached) return cached;

    const connected = multilayerObstacles.filter((obstacle) =>
      isObstacleConnectedToRoute(obstacle, route, connMap),
    );
    byRootConnectionName.set(route.rootConnectionName, connected);
    return connected;
  };

  return (hdRoutes: HighDensityRoute[]): SimplifiedPcbTraces => {
    const traces: SimplifiedPcbTraces = [];
    const routesByConnectionName = new Map<string, HighDensityRoute[]>();
    for (const route of hdRoutes) {
      const connectionRoutes = routesByConnectionName.get(route.connectionName);
      if (connectionRoutes) {
        connectionRoutes.push(route);
      } else {
        routesByConnectionName.set(route.connectionName, [route]);
      }
    }

    for (const {
      connection,
      connectsTo,
      outputConnectionName,
    } of preparedConnections) {
      const connectionRoutes =
        routesByConnectionName.get(connection.name) ?? [];

      for (let index = 0; index < connectionRoutes.length; index += 1) {
        const hdRoute = connectionRoutes[index]!;
        traces.push({
          type: "pcb_trace",
          pcb_trace_id: `${connection.name}_${index}`,
          connection_name: outputConnectionName,
          connectsTo,
          route: convertHdRouteToSimplifiedRoute(hdRoute, layerCount, {
            connectionPoints: connection.pointsToConnect,
            defaultViaHoleDiameter,
            connectedMultilayerObstacles:
              getConnectedMultilayerObstacles(hdRoute),
            connMap,
          }),
        });
      }
    }

    return traces;
  };
};

/** Converts Pipeline7 routes using the same net and terminal rules as final output. */
export const convertPipeline7HdRoutesToSimplifiedPcbTraces = ({
  connections,
  originalConnections,
  hdRoutes,
  layerCount,
  obstacles,
  defaultViaHoleDiameter,
  connMap,
}: ConvertPipeline7HdRoutesOptions): SimplifiedPcbTraces =>
  createPipeline7HdRoutesToSimplifiedPcbTracesConverter({
    connections,
    originalConnections,
    layerCount,
    obstacles,
    defaultViaHoleDiameter,
    connMap,
  })(hdRoutes);
