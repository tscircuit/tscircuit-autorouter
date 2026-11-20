import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { gunzipSync } from "node:zlib"
import { distancePointToObstacle } from "../node_modules/@tscircuit/fanout-solver/lib/geometry.ts"
import { obstacleSharesElectricalNet } from "../node_modules/@tscircuit/fanout-solver/lib/net-identity.ts"

const directory = process.argv[2]
const audits = []
for (const filename of readdirSync(directory)) {
  if (!filename.endsWith("-input.json.gz")) continue
  const args = JSON.parse(gunzipSync(readFileSync(join(directory, filename))).toString())
  const input = args[0]
  if (!input?.connections || !input?.obstacles || !args[1]?.sharedBoundary) continue
  const exits = input.connections.flatMap((connection: any) => connection.pointsToConnect
    .filter((point: any) => String(point.pointId).startsWith("pcb_breakout_point_"))
    .map((point: any) => ({
      connection: connection.name, point,
      foreignPours: input.obstacles.filter((obstacle: any) => obstacle.isCopperPour &&
        obstacle.layers.includes(point.layer) &&
        !obstacleSharesElectricalNet(input, obstacle, connection.name) &&
        distancePointToObstacle(point, obstacle) === 0).length,
    })))
  audits.push({ filename, exits: exits.length, insideForeignPours: exits.filter((exit: any) => exit.foreignPours > 0).length, points: exits })
}
writeFileSync(join(directory, "exit-layers.json"), JSON.stringify(audits, null, 2))
console.log("EXIT_LAYERS", JSON.stringify(audits.map(({ points, ...summary }) => summary)))
