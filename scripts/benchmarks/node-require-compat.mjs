import {createRequire} from 'node:module'
import {resolve} from 'node:path'
globalThis.require=createRequire(resolve('package.json'))
