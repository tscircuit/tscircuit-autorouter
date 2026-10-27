import {readFileSync,writeFileSync} from "node:fs"
import {gunzipSync} from "node:zlib"
import {getSvgFromGraphicsObject} from "graphics-debug"
import {convertSrjToGraphicsObject} from "lib/utils/convertSrjToGraphicsObject"
import type {SimpleRouteJson,SimplifiedPcbTrace} from "lib/types"
const directory="tests/features/fixtures/am3352-reset-preload"
const input=JSON.parse(gunzipSync(readFileSync(directory+"/routing-input.json.gz")).toString()) as SimpleRouteJson
const witness=JSON.parse(readFileSync(directory+"/reset-routing-witness.json","utf8")) as SimplifiedPcbTrace[]
const graphics=convertSrjToGraphicsObject({...input,traces:[...input.traces??[],...witness]})
graphics.points=[]
const svg=getSvgFromGraphicsObject(graphics,{backgroundColor:"white"}).replace("</svg>",'<rect x="12" y="12" width="800" height="64" fill="white"/><text x="24" y="36" font-family="Arial" font-size="18">AM3352: preserved DDR + successful reset-tree routing witness</text><text x="24" y="62" font-family="Arial" font-size="14">Native solver-generated diagnostic; the rest of the board is not shown as complete.</text></svg>')
writeFileSync(directory+"/reset-routing-witness.svg",svg)
