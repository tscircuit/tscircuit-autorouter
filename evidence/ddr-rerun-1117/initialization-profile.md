# CPU Profile
| Duration | Samples | Interval | Functions |
|----------|---------|----------|----------|
| 624.46s | 540595 | 1.0ms | 4226 |
**Top 10:** `recurse` 17.7%, `get lowercaseComponentName` 15.1%, `recurse` 10.4%, `getName` 7.0%, `get name` 5.5%, `getOrCreateNetwork` 5.4%, `get isSubcircuit` 3.8%, `get componentName` 2.9%, `filter` 2.8%, `getNameAndAliases` 2.8%
## Hot Functions (Self Time)
| Self% | Self | Total% | Total | Function | Location |
|------:|-----:|-------:|------:|----------|----------|
| 17.7% | 111.01s | 17.7% | 111.01s | `recurse` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:147863` |
| 15.1% | 94.51s | 20.9% | 130.74s | `get lowercaseComponentName` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:147992` |
| 10.4% | 64.96s | 54.0% | 337.51s | `recurse` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:147860` |
| 7.0% | 44.12s | 23.4% | 146.54s | `getName` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:147785` |
| 5.5% | 34.52s | 5.5% | 34.52s | `get name` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:148005` |
| 5.4% | 33.95s | 5.4% | 33.95s | `getOrCreateNetwork` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:157` |
| 3.8% | 24.19s | 8.4% | 52.97s | `get isSubcircuit` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:147996` |
| 2.9% | 18.12s | 5.4% | 33.94s | `get componentName` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:147961` |
| 2.8% | 17.95s | 13.3% | 83.21s | `filter` | `[native code]` |
| 2.8% | 17.68s | 10.6% | 66.31s | `getNameAndAliases` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:148624` |
| 2.4% | 15.33s | 18.6% | 116.58s | `getAttributeValue` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:147788` |
| 2.2% | 13.80s | 2.3% | 14.97s | `from` | `[native code]` |
| 1.7% | 10.98s | 1.7% | 10.98s | `getNameAndAliases` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:186283` |
| 1.6% | 10.32s | 1.6% | 10.32s | `Set` | `[native code]` |
| 1.1% | 7.07s | 1.2% | 7.58s | `element` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:146050` |
| 0.8% | 5.26s | 0.8% | 5.26s | `getNameAndAliases` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:186280` |
| 0.7% | 4.80s | 0.8% | 5.02s | `(anonymous)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:16740` |
| 0.7% | 4.60s | 0.7% | 4.60s | `get config` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.7% | 4.59s | 95.5% | 596.17s | `recurse` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:147864` |
| 0.6% | 4.15s | 0.6% | 4.15s | `getNameAndAliases` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:186281` |
| 0.5% | 3.64s | 0.5% | 3.64s | `getNameAndAliases` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:186282` |
| 0.5% | 3.34s | 0.5% | 3.34s | `(anonymous)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:16725` |
| 0.4% | 3.10s | 0.4% | 3.10s | `getOrCreateNetwork` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:156` |
| 0.4% | 3.07s | 4.1% | 25.73s | `(anonymous)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:147894` |
| 0.4% | 2.93s | 2.7% | 16.90s | `find` | `[native code]` |
| 0.4% | 2.57s | 0.4% | 2.57s | `(anonymous)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.3% | 2.32s | 5.2% | 32.63s | `(anonymous)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:147898` |
| 0.3% | 2.30s | 0.3% | 2.30s | `get componentName` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.3% | 2.03s | 0.8% | 5.40s | `dynCall` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:302370` |
| 0.3% | 1.98s | 59.4% | 371.36s | `some` | `[native code]` |
| 0.3% | 1.96s | 0.3% | 1.96s | `get config` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:192059` |
| 0.3% | 1.96s | 0.3% | 1.96s | `(anonymous)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:16744` |
| 0.2% | 1.72s | 0.2% | 1.72s | `get config` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:200639` |
| 0.2% | 1.68s | 0.2% | 1.68s | `get config` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:211422` |
| 0.2% | 1.64s | 0.2% | 1.64s | `(anonymous)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/node_modules/circuit-to-svg/dist/index.js:1496` |
| 0.2% | 1.61s | 0.2% | 1.61s | `get config` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:200230` |
| 0.2% | 1.46s | 0.2% | 1.46s | `get config` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:186099` |
| 0.2% | 1.25s | 0.2% | 1.25s | `get config` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:185443` |
| 0.1% | 1.17s | 0.1% | 1.17s | `arrayFromFastWithoutMapFn` | `[native code]` |
| 0.1% | 1.02s | 0.2% | 1.42s | `.wasm-function[255]` | `[native code]` |
| 0.1% | 992.0ms | 0.1% | 992.0ms | `(anonymous)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:162408` |
| 0.1% | 978.4ms | 0.1% | 978.4ms | `getOrCreateNetwork` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:162` |
| 0.1% | 947.4ms | 0.1% | 1.09s | `runRenderPhase` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:147040` |
| 0.1% | 918.8ms | 0.1% | 932.6ms | `findConnectedNetworks` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:174` |
| 0.1% | 884.4ms | 0.1% | 884.4ms | `(anonymous)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:164953` |
| 0.1% | 869.1ms | 0.1% | 890.6ms | `convertPortSelectorToEndpointKey` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:355738` |
| 0.1% | 859.9ms | 0.1% | 859.9ms | `includes` | `[native code]` |
| 0.1% | 845.4ms | 0.1% | 845.4ms | `element` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.1% | 818.8ms | 0.1% | 818.8ms | `(anonymous)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:303601` |
| 0.1% | 696.0ms | 0.1% | 696.0ms | `runRenderPhaseForChildren` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:147049` |
| 0.1% | 686.6ms | 35.9% | 224.16s | `map` | `[native code]` |
| 0.0% | 555.6ms | 0.0% | 555.6ms | `tag` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 534.9ms | 0.0% | 534.9ms | `scheduleTaskForRootDuringMicrotask` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 510.3ms | 0.0% | 510.3ms | `get config` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:204344` |
| 0.0% | 503.4ms | 0.1% | 980.6ms | `_getRootCircuit` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:147059` |
| 0.0% | 498.6ms | 0.0% | 498.6ms | `getNetConnectedToId` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:238` |
| 0.0% | 486.3ms | 0.1% | 850.5ms | `low` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:15898` |
| 0.0% | 459.7ms | 0.0% | 459.7ms | `get lowercaseComponentName` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 431.0ms | 0.1% | 1.07s | `get root` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:148536` |
| 0.0% | 413.6ms | 0.0% | 413.6ms | `buildSubcircuitConnectivityLookup` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:304447` |
| 0.0% | 387.7ms | 0.0% | 387.7ms | `recurse` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:147861` |
| 0.0% | 369.0ms | 0.0% | 369.0ms | `convert` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:302372` |
| 0.0% | 354.5ms | 0.0% | 354.5ms | `findConnectedNetworks` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:179` |
| 0.0% | 349.3ms | 0.0% | 349.3ms | `getElementId` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:17605` |
| 0.0% | 342.8ms | 0.0% | 342.8ms | `getOrCreateNetwork` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 342.3ms | 0.0% | 540.1ms | `every` | `[native code]` |
| 0.0% | 332.1ms | 0.0% | 332.1ms | `_processInputParams` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:1319` |
| 0.0% | 328.6ms | 1.2% | 7.59s | `runRenderPhaseForChildren` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:147053` |
| 0.0% | 308.2ms | 0.0% | 308.2ms | `Shape` | `[native code]` |
| 0.0% | 301.9ms | 0.0% | 301.9ms | `unshift` | `[native code]` |
| 0.0% | 300.6ms | 0.0% | 300.6ms | `get config` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:370665` |
| 0.0% | 288.3ms | 0.0% | 288.3ms | `getNameAndAliases` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:186284` |
| 0.0% | 287.6ms | 0.2% | 1.30s | `(anonymous)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:340546` |
| 0.0% | 279.1ms | 0.0% | 327.0ms | `preprocessSelector` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:147919` |
| 0.0% | 266.2ms | 0.0% | 266.2ms | `ConnectivityMap` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:195` |
| 0.0% | 247.9ms | 0.0% | 247.9ms | `update_max` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 245.8ms | 0.0% | 245.8ms | `Point2` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 243.5ms | 0.0% | 243.5ms | `(anonymous)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/node_modules/circuit-to-svg/dist/index.js` |
| 0.0% | 237.7ms | 0.0% | 244.4ms | `.wasm-function[39]` | `[native code]` |
| 0.0% | 235.2ms | 23.5% | 146.78s | `tag` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:146601` |
| 0.0% | 233.2ms | 0.0% | 235.6ms | `selectOne` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:148783` |
| 0.0% | 222.4ms | 2.7% | 17.33s | `findConnectedNetworks` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:176` |
| 0.0% | 218.2ms | 0.0% | 218.2ms | `(anonymous)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/node_modules/circuit-to-svg/dist/index.js:1511` |
| 0.0% | 215.4ms | 0.0% | 215.4ms | `stringify` | `[native code]` |
| 0.0% | 215.1ms | 0.0% | 215.1ms | `node:crypto` | `node:crypto:219` |
| 0.0% | 213.1ms | 0.0% | 362.3ms | `getSubcircuit` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:148653` |
| 0.0% | 209.2ms | 0.0% | 209.2ms | `runRenderPhase` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 208.7ms | 0.0% | 208.7ms | `get` | `[native code]` |
| 0.0% | 203.9ms | 0.0% | 203.9ms | `cloneObject` | `[native code]` |
| 0.0% | 200.5ms | 0.0% | 200.5ms | `runRenderPhase` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:147006` |
| 0.0% | 195.7ms | 0.0% | 218.8ms | `getName` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:145577` |
| 0.0% | 191.3ms | 0.0% | 378.5ms | `anonymous` | `[native code]` |
| 0.0% | 188.4ms | 0.0% | 188.4ms | `buildSubcircuitConnectivityLookup` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:304456` |
| 0.0% | 188.0ms | 0.0% | 188.0ms | `(anonymous)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:304462` |
| 0.0% | 186.2ms | 0.0% | 187.5ms | `NormalComponent_doInitialSourceDesignRuleChecks` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:205100` |
| 0.0% | 183.0ms | 0.0% | 183.0ms | `get name` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 179.4ms | 0.0% | 187.6ms | `(anonymous)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:13980` |
| 0.0% | 179.2ms | 0.0% | 179.2ms | `get isSubcircuit` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 168.4ms | 0.0% | 191.0ms | `get config` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:368420` |
| 0.0% | 154.0ms | 0.1% | 628.1ms | `_hasIncompleteAsyncEffectsForPhase` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:146973` |
| 0.0% | 149.4ms | 0.0% | 176.7ms | `emval_returnValue` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:303227` |
| 0.0% | 148.8ms | 0.0% | 148.8ms | `toWireType` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:301843` |
| 0.0% | 142.8ms | 0.0% | 142.8ms | `/(?:^\|\s)pin1(?:$\|\s)/` | `[native code]` |
| 0.0% | 142.4ms | 0.0% | 143.3ms | `unescapeCSS` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:145558` |
| 0.0% | 136.4ms | 0.1% | 1.00s | `reduce` | `[native code]` |
| 0.0% | 136.0ms | 0.0% | 136.0ms | `get config` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:365610` |
| 0.0% | 134.5ms | 0.0% | 134.5ms | `.wasm-function[34]` | `[native code]` |
| 0.0% | 133.6ms | 0.0% | 133.6ms | `(module)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/node_modules/fflate/esm/index.mjs:77` |
| 0.0% | 133.4ms | 0.0% | 133.4ms | `create` | `[native code]` |
| 0.0% | 129.2ms | 1.7% | 10.77s | `getNameAndAliases` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:186279` |
| 0.0% | 127.6ms | 0.0% | 127.6ms | `parseSelector` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:145575` |
| 0.0% | 125.9ms | 0.0% | 125.9ms | `toWireType` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 125.9ms | 0.0% | 129.0ms | `selectOne` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:148748` |
| 0.0% | 125.2ms | 0.0% | 125.2ms | `compileGeneralSelector` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:146572` |
| 0.0% | 122.7ms | 0.0% | 122.7ms | `getDescendantSubcircuitIds2` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:304407` |
| 0.0% | 119.8ms | 0.0% | 119.8ms | `runRenderPhaseForChildren` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 119.0ms | 0.0% | 119.0ms | `normalizeRing` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:303595` |
| 0.0% | 119.0ms | 0.0% | 119.0ms | `injectFakeEmitter` | `node:worker_threads` |
| 0.0% | 116.6ms | 0.0% | 116.6ms | `compilePseudoSelector` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:146525` |
| 0.0% | 115.6ms | 0.0% | 117.8ms | `(anonymous)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:192076` |
| 0.0% | 114.9ms | 0.0% | 120.8ms | `performIteration` | `[native code]` |
| 0.0% | 112.3ms | 0.0% | 134.8ms | `getNearestExternalMember` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/native-full-board.tsx:38` |
| 0.0% | 111.6ms | 0.0% | 111.6ms | `charCodeAt` | `[native code]` |
| 0.0% | 108.8ms | 0.0% | 108.8ms | `dynCall` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:302368` |
| 0.0% | 104.9ms | 0.0% | 141.2ms | `parseSelector` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:145834` |
| 0.0% | 99.9ms | 0.0% | 99.9ms | `/(?:^\|\s)pin2(?:$\|\s)/` | `[native code]` |
| 0.0% | 99.7ms | 0.0% | 279.8ms | `runRenderPhase` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:147046` |
| 0.0% | 99.5ms | 0.7% | 4.61s | `(anonymous)` | `[native code]` |
| 0.0% | 99.2ms | 0.0% | 99.2ms | `.wasm-function[441]` | `[native code]` |
| 0.0% | 99.2ms | 0.1% | 986.5ms | `tree_search_interval` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:13078` |
| 0.0% | 99.1ms | 18.6% | 116.70s | `element` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:146049` |
| 0.0% | 98.9ms | 0.0% | 98.9ms | `getElementSubcircuitId` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:304398` |
| 0.0% | 96.4ms | 0.0% | 96.4ms | `buildSubcircuitConnectivityLookup` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:304454` |
| 0.0% | 94.6ms | 0.0% | 111.3ms | `element` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:146047` |
| 0.0% | 91.3ms | 0.0% | 91.3ms | `compileGeneralSelector` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:146598` |
| 0.0% | 90.7ms | 72.6% | 453.60s | `findAll` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:147868` |
| 0.0% | 90.1ms | 0.0% | 90.1ms | `convertCircuitJsonToInputProblem` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:304592` |
| 0.0% | 87.9ms | 0.0% | 87.9ms | `fromEntries` | `[native code]` |
| 0.0% | 87.3ms | 0.0% | 87.3ms | `normalizeRing` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:303591` |
| 0.0% | 85.5ms | 0.0% | 85.5ms | `runRenderPhase` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:147005` |
| 0.0% | 83.3ms | 0.0% | 125.9ms | `.wasm-function[254]` | `[native code]` |
| 0.0% | 83.3ms | 0.0% | 266.0ms | `forEach` | `[native code]` |
| 0.0% | 82.6ms | 0.0% | 150.2ms | `(anonymous)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:16998` |
| 0.0% | 82.0ms | 0.0% | 82.0ms | `Map` | `[native code]` |
| 0.0% | 81.5ms | 0.0% | 81.5ms | `parseSelector` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:145811` |
| 0.0% | 80.5ms | 0.0% | 341.1ms | `getSimpleRouteJsonFromCircuitJson` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:340312` |
| 0.0% | 76.9ms | 0.4% | 3.01s | `wasm-stub` | `[native code]` |
| 0.0% | 76.0ms | 0.0% | 76.0ms | `getFullConnectivityMapFromCircuitJson` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:301` |
| 0.0% | 75.8ms | 0.0% | 75.8ms | `set` | `[native code]` |
| 0.0% | 75.3ms | 0.0% | 356.7ms | `absolutize` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:146719` |
| 0.0% | 74.9ms | 0.0% | 74.9ms | `get config` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:194786` |
| 0.0% | 74.7ms | 0.0% | 87.6ms | `parseSelector` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:145645` |
| 0.0% | 73.8ms | 0.0% | 73.8ms | `parseSelector` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 73.7ms | 0.0% | 192.9ms | `(anonymous)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:18291` |
| 0.0% | 73.6ms | 0.0% | 73.6ms | `get config` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:193727` |
| 0.0% | 71.2ms | 0.0% | 71.2ms | `circleToPolygon` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:303762` |
| 0.0% | 70.3ms | 0.0% | 70.3ms | `embind__requireFunction` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 69.5ms | 0.0% | 71.9ms | `zc` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/node_modules/@tscircuit/capacity-autorouter/dist/index.js:1` |
| 0.0% | 67.6ms | 3.3% | 21.01s | `findConnectedNetworks` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:171` |
| 0.0% | 67.3ms | 0.0% | 90.4ms | `.wasm-function[320]` | `[native code]` |
| 0.0% | 66.9ms | 0.0% | 66.9ms | `entries` | `[native code]` |
| 0.0% | 65.6ms | 0.2% | 1.44s | `(unknown)` | `[native code]` |
| 0.0% | 63.6ms | 0.0% | 85.5ms | `high` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:15901` |
| 0.0% | 61.8ms | 64.9% | 405.60s | `selectOne` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:148762` |
| 0.0% | 60.3ms | 0.0% | 66.1ms | `preprocessSelector` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:147911` |
| 0.0% | 60.2ms | 0.5% | 3.12s | `select` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:146803` |
| 0.0% | 58.5ms | 0.0% | 170.2ms | `parseSelector` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:145839` |
| 0.0% | 58.4ms | 0.0% | 58.4ms | `/^[^\\#]?(?:\\(?:[\da-f]{1,6}\s?\|.)\|[\w\-\u00b0-\uFFFF])+/` | `[native code]` |
| 0.0% | 58.0ms | 0.0% | 58.0ms | `RegisteredPointer_fromWireType` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:302302` |
| 0.0% | 57.1ms | 0.0% | 57.1ms | `flatIntoArray` | `[native code]` |
| 0.0% | 57.0ms | 0.0% | 57.0ms | `.wasm-function[317]` | `[native code]` |
| 0.0% | 56.7ms | 0.0% | 56.7ms | `get config` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:365594` |
| 0.0% | 56.0ms | 0.0% | 94.9ms | `(anonymous)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:16976` |
| 0.0% | 52.9ms | 0.0% | 214.8ms | `dynCall` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:302369` |
| 0.0% | 52.6ms | 0.0% | 62.9ms | `lessThan` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:14829` |
| 0.0% | 51.8ms | 0.0% | 119.2ms | `.wasm-function[322]` | `[native code]` |
| 0.0% | 51.4ms | 0.0% | 51.4ms | `(anonymous)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/node_modules/circuit-to-svg/dist/index.js:1518` |
| 0.0% | 50.4ms | 0.0% | 50.4ms | `(anonymous)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/node_modules/circuit-to-svg/dist/index.js:1462` |
| 0.0% | 49.9ms | 0.0% | 49.9ms | `(anonymous)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:340570` |
| 0.0% | 49.9ms | 0.0% | 49.9ms | `add` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:14750` |
| 0.0% | 48.6ms | 0.0% | 56.8ms | `Segment` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:15029` |
| 0.0% | 48.5ms | 0.0% | 48.5ms | `(anonymous)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:303616` |
| 0.0% | 48.5ms | 0.0% | 48.5ms | `get root` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 47.5ms | 34.9% | 218.06s | `runRenderPhaseForChildren` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:147054` |
| 0.0% | 45.9ms | 0.0% | 45.9ms | `preprocessSelector` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:147914` |
| 0.0% | 45.3ms | 0.0% | 79.3ms | `equalTo` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:14826` |
| 0.0% | 45.2ms | 0.1% | 950.1ms | `vec2polygons` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:300844` |
| 0.0% | 45.0ms | 9.8% | 61.34s | `select` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:146805` |
| 0.0% | 44.6ms | 0.0% | 44.6ms | `has` | `[native code]` |
| 0.0% | 44.6ms | 0.0% | 44.6ms | `preprocessSelector` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:147922` |
| 0.0% | 44.4ms | 0.0% | 44.4ms | `polygonContainsPoint` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:163863` |
| 0.0% | 44.1ms | 0.0% | 44.1ms | `get config` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:370142` |
| 0.0% | 43.4ms | 0.0% | 43.4ms | `Node` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 42.9ms | 0.0% | 104.1ms | `convertCircuitJsonToInputProblem` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:304597` |
| 0.0% | 42.7ms | 0.0% | 42.7ms | `_getTracePortOrNetSelectorListFromProps` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:192067` |
| 0.0% | 42.5ms | 0.0% | 42.5ms | `getScopedSubcircuitConnectivityKey` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:304401` |
| 0.0% | 42.5ms | 0.0% | 45.9ms | `getDescendantSubcircuitIds2` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:304415` |
| 0.0% | 42.2ms | 0.0% | 42.2ms | `/(^\|[ >])(?!pin\.)(?!port\.)(?!net\.)([A-Z][A-Za-z0-9_-]*)\.([A-Za-z0-9_-]+)/g` | `[native code]` |
| 0.0% | 41.3ms | 0.0% | 41.3ms | `(module)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/node_modules/format-si-unit/dist/index.js:23` |
| 0.0% | 40.9ms | 0.0% | 40.9ms | `EQ` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 40.2ms | 0.0% | 40.2ms | `structuredClone` | `[native code]` |
| 0.0% | 39.7ms | 0.0% | 47.5ms | `child` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:146647` |
| 0.0% | 39.4ms | 0.2% | 1.57s | `bound toWireType` | `[native code]` |
| 0.0% | 39.4ms | 0.0% | 71.0ms | `getSimpleRouteJsonFromCircuitJson` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:340341` |
| 0.0% | 39.2ms | 0.0% | 39.2ms | `getProcedure` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 39.0ms | 0.0% | 39.0ms | `Node` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:12674` |
| 0.0% | 38.7ms | 0.0% | 77.5ms | `writeFileSync` | `[native code]` |
| 0.0% | 38.4ms | 100.0% | 752.78s | `runRenderPhase` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:147044` |
| 0.0% | 38.2ms | 0.0% | 38.2ms | `getFullConnectivityMapFromCircuitJson` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:290` |
| 0.0% | 37.9ms | 0.0% | 37.9ms | `_hasIncompleteAsyncEffectsForPhase` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:361249` |
| 0.0% | 37.1ms | 0.0% | 69.6ms | `.wasm-function[76]` | `[native code]` |
| 0.0% | 36.6ms | 0.0% | 36.6ms | `(anonymous)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:367742` |
| 0.0% | 36.4ms | 0.0% | 395.1ms | `read` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:301828` |
| 0.0% | 36.0ms | 0.0% | 36.0ms | `root` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:148536` |
| 0.0% | 34.5ms | 0.0% | 36.9ms | `buildSubcircuitConnectivityLookup` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:304455` |
| 0.0% | 34.5ms | 0.0% | 34.5ms | `_parse` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:3173` |
| 0.0% | 34.3ms | 0.0% | 34.3ms | `(anonymous)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:304582` |
| 0.0% | 33.8ms | 0.0% | 33.8ms | `compileGeneralSelector` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 33.4ms | 0.0% | 33.4ms | `keys` | `[native code]` |
| 0.0% | 32.7ms | 0.0% | 33.8ms | `selectOne` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:148753` |
| 0.0% | 32.7ms | 58.7% | 366.44s | `getTraceRoutingPhaseIndex` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:355710` |
| 0.0% | 32.3ms | 0.0% | 32.3ms | `.wasm-function[455]` | `[native code]` |
| 0.0% | 32.0ms | 0.0% | 32.0ms | `buildSubcircuitConnectivityLookup` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:304474` |
| 0.0% | 31.5ms | 0.0% | 45.6ms | `bound nonConstNoSmartPtrRawPointerToWireType` | `[native code]` |
| 0.0% | 31.0ms | 0.0% | 44.1ms | `lowercaseComponentName` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:147992` |
| 0.0% | 30.6ms | 0.0% | 393.1ms | `getSubcircuit` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:148655` |
| 0.0% | 30.3ms | 0.1% | 1.16s | `parse` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:145568` |
| 0.0% | 28.7ms | 0.1% | 1.20s | `tree_search_interval` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:13072` |
| 0.0% | 28.5ms | 0.0% | 28.5ms | `compilePseudoSelector` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:146532` |
| 0.0% | 28.0ms | 0.0% | 28.0ms | `cachedDescendant` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:146618` |
| 0.0% | 27.7ms | 0.0% | 28.9ms | `findConnectedNetworks` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:170` |
| 0.0% | 27.2ms | 0.0% | 81.4ms | `.wasm-function[440]` | `[native code]` |
| 0.0% | 27.1ms | 0.0% | 27.1ms | `normalizeRing` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:303593` |
| 0.0% | 26.6ms | 0.0% | 26.6ms | `get box` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 25.4ms | 0.0% | 25.4ms | `getAttributeValue` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:147787` |
| 0.0% | 25.3ms | 0.0% | 31.0ms | `(anonymous)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:146754` |
| 0.0% | 25.2ms | 0.0% | 140.9ms | `get config` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:368419` |
| 0.0% | 25.2ms | 5.6% | 35.29s | `selectOne` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:148784` |
| 0.0% | 24.8ms | 0.0% | 24.8ms | `_parse` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:3177` |
| 0.0% | 24.8ms | 0.0% | 27.3ms | `get` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:16918` |
| 0.0% | 24.4ms | 0.0% | 24.4ms | `copyDataProperties` | `[native code]` |
| 0.0% | 23.9ms | 0.0% | 23.9ms | `split` | `[native code]` |
| 0.0% | 23.6ms | 0.0% | 23.6ms | `runRenderPhase` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:147026` |
| 0.0% | 23.0ms | 0.0% | 23.0ms | `buildSubcircuitConnectivityLookup` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:304457` |
| 0.0% | 22.2ms | 0.0% | 22.2ms | `add` | `[native code]` |
| 0.0% | 22.0ms | 0.0% | 22.0ms | `doInitialCreateAutoplacedBreakoutPoints` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:368460` |
| 0.0% | 21.8ms | 57.3% | 357.93s | `(anonymous)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:146838` |
| 0.0% | 21.5ms | 0.0% | 21.5ms | `getFullConnectivityMapFromCircuitJson` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:287` |
| 0.0% | 21.1ms | 0.0% | 21.1ms | `bind` | `[native code]` |
| 0.0% | 21.0ms | 0.0% | 22.1ms | `start` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:13264` |
| 0.0% | 20.5ms | 0.0% | 574.9ms | `(anonymous)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:355710` |
| 0.0% | 20.4ms | 0.0% | 21.4ms | `escapeAttr` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/node_modules/svgson/dist/svgson.cjs.js:45` |
| 0.0% | 20.3ms | 0.0% | 20.3ms | `(anonymous)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:162410` |
| 0.0% | 20.3ms | 0.0% | 20.3ms | `connect` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:16478` |
| 0.0% | 20.2ms | 0.1% | 673.8ms | `compileToken` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:146733` |
| 0.0% | 19.9ms | 0.0% | 19.9ms | `compileGeneralSelector` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:146616` |
| 0.0% | 19.6ms | 0.0% | 19.6ms | `(anonymous)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/node_modules/circuit-to-svg/dist/index.js:1465` |
| 0.0% | 19.4ms | 0.0% | 19.4ms | `get` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 19.4ms | 43.0% | 268.71s | `select` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:146806` |
| 0.0% | 19.3ms | 0.0% | 19.3ms | `finalizeSubselector` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:145637` |
| 0.0% | 19.2ms | 0.0% | 19.2ms | `getPrimaryId` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:18080` |
| 0.0% | 19.1ms | 0.0% | 22.6ms | `getCopperPourConnectivity` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:162333` |
| 0.0% | 18.9ms | 0.0% | 18.9ms | `unregister` | `[native code]` |
| 0.0% | 18.8ms | 0.0% | 18.8ms | `selectAll` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 18.8ms | 0.0% | 18.8ms | `(anonymous)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:370452` |
| 0.0% | 18.8ms | 0.0% | 18.8ms | `convertOptionFormats` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 18.4ms | 0.0% | 19.5ms | `.wasm-function[146]` | `[native code]` |
| 0.0% | 18.2ms | 0.0% | 18.2ms | `selectNetByLiteralSelector` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:144503` |
| 0.0% | 18.1ms | 0.0% | 18.1ms | `getSubcircuitConnectivityKeyForId` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:304514` |
| 0.0% | 18.1ms | 0.0% | 28.3ms | `cju` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:16675` |
| 0.0% | 17.9ms | 0.0% | 17.9ms | `ZodType` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/router/node_modules/zod/v3/types.js:275` |
| 0.0% | 17.7ms | 0.0% | 120.1ms | `(module)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/node_modules/@tscircuit/capacity-autorouter/dist/index.js:1` |
| 0.0% | 17.6ms | 0.0% | 176.9ms | `absolutize` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:146713` |
| 0.0% | 17.2ms | 0.0% | 108.0ms | `box` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:13980` |
| 0.0% | 17.2ms | 0.0% | 474.4ms | `selectOne` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:148756` |
| 0.0% | 17.1ms | 0.0% | 17.1ms | `translate` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 17.1ms | 0.0% | 529.2ms | `_emitRenderLifecycleEvent` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:146929` |
| 0.0% | 17.1ms | 0.0% | 17.1ms | `cjuIndexed` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:16812` |
| 0.0% | 17.0ms | 0.0% | 17.0ms | `push` | `[native code]` |
| 0.0% | 17.0ms | 0.1% | 769.4ms | `.wasm-function[939]` | `[native code]` |
| 0.0% | 17.0ms | 0.0% | 43.6ms | `.wasm-function[60]` | `[native code]` |
| 0.0% | 17.0ms | 0.0% | 344.2ms | `search` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:12835` |
| 0.0% | 17.0ms | 0.0% | 17.0ms | `getWhere` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:16739` |
| 0.0% | 17.0ms | 0.0% | 17.0ms | `sortByProcedure` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 16.9ms | 0.0% | 103.8ms | `traceHasEndpointMatchingConnectionSelector` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:355750` |
| 0.0% | 16.7ms | 0.0% | 16.7ms | `.wasm-function[444]` | `[native code]` |
| 0.0% | 16.5ms | 0.0% | 209.1ms | `Point2` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:14787` |
| 0.0% | 16.5ms | 0.0% | 16.5ms | `/(?:^\|\s)pin3(?:$\|\s)/` | `[native code]` |
| 0.0% | 16.4ms | 0.0% | 481.3ms | `intersectPolygon2Polygon` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:11435` |
| 0.0% | 16.0ms | 0.0% | 16.0ms | `buildSubcircuitConnectivityLookup` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:304481` |
| 0.0% | 15.7ms | 0.0% | 36.3ms | `search` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:12833` |
| 0.0% | 15.6ms | 0.0% | 15.6ms | `distanceTo` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 15.5ms | 0.0% | 15.5ms | `/(?:^\|\s)pin4(?:$\|\s)/` | `[native code]` |
| 0.0% | 15.4ms | 0.0% | 84.6ms | `rotate` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:13235` |
| 0.0% | 15.3ms | 0.0% | 15.3ms | `nonConstNoSmartPtrRawPointerToWireType` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 15.2ms | 0.2% | 1.43s | `normalizeRing` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:303601` |
| 0.0% | 15.2ms | 0.0% | 15.2ms | `Boolean` | `[native code]` |
| 0.0% | 15.1ms | 0.0% | 40.9ms | `clone` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:14820` |
| 0.0% | 15.1ms | 0.0% | 35.6ms | `.wasm-function[314]` | `[native code]` |
| 0.0% | 14.9ms | 0.1% | 840.9ms | `write` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:301830` |
| 0.0% | 14.8ms | 0.0% | 14.8ms | `mergeObjectSync` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:1194` |
| 0.0% | 14.8ms | 0.0% | 14.8ms | `_getTracePortOrNetSelectorListFromProps` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 14.8ms | 0.0% | 14.8ms | `convertCircuitJsonToInputProblem` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:304590` |
| 0.0% | 14.6ms | 0.0% | 14.6ms | `element` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:146044` |
| 0.0% | 14.2ms | 0.0% | 14.2ms | `createIdKey` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:16587` |
| 0.0% | 14.2ms | 0.0% | 14.2ms | `convertCircuitJsonToInputProblem` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:304591` |
| 0.0% | 14.1ms | 0.0% | 14.1ms | `getFullConnectivityMapFromCircuitJson` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:286` |
| 0.0% | 14.0ms | 0.0% | 212.4ms | `runRenderPhase` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:147034` |
| 0.0% | 13.9ms | 0.0% | 96.0ms | `parseSelector` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:145686` |
| 0.0% | 13.8ms | 0.0% | 13.8ms | `scope` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:146339` |
| 0.0% | 13.7ms | 0.0% | 438.4ms | `compileRules` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:146754` |
| 0.0% | 13.6ms | 0.0% | 13.6ms | `parse` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 13.4ms | 0.0% | 13.4ms | `buildSubcircuitConnectivityLookup` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:304465` |
| 0.0% | 13.4ms | 0.0% | 21.6ms | `(anonymous)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:148630` |
| 0.0% | 13.4ms | 0.0% | 13.4ms | `breakToFunctional` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:15751` |
| 0.0% | 13.3ms | 0.0% | 13.3ms | `LT` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 13.3ms | 0.0% | 56.5ms | `box` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:13273` |
| 0.0% | 13.3ms | 0.0% | 41.2ms | `transform` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:14836` |
| 0.0% | 13.1ms | 0.0% | 18.8ms | `_parse` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/node_modules/zod/v3/types.js:2319` |
| 0.0% | 13.1ms | 0.0% | 85.3ms | `absolutize` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:146718` |
| 0.0% | 13.0ms | 0.1% | 853.9ms | `toWireType` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:301849` |
| 0.0% | 12.9ms | 0.0% | 12.9ms | `stripWhitespace` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 12.8ms | 0.0% | 12.8ms | `circleToPolygon` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:303760` |
| 0.0% | 12.7ms | 0.0% | 12.7ms | `makeIssue` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/node_modules/zod/v3/helpers/parseUtil.js:5` |
| 0.0% | 12.7ms | 0.0% | 12.7ms | `(anonymous)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:146839` |
| 0.0% | 12.7ms | 0.0% | 12.7ms | `selectAll` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:148725` |
| 0.0% | 12.5ms | 0.0% | 31.8ms | `get box` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:15081` |
| 0.0% | 12.4ms | 0.0% | 12.4ms | `/(?:^\|\s)pin5(?:$\|\s)/` | `[native code]` |
| 0.0% | 12.4ms | 0.0% | 12.4ms | `ZodType` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:1483` |
| 0.0% | 12.4ms | 0.0% | 27.4ms | `Group_getRoutingPhasePlans` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:355882` |
| 0.0% | 12.3ms | 0.2% | 1.53s | `toScaledManifoldPolygons` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:303610` |
| 0.0% | 12.3ms | 0.0% | 12.3ms | `_parse` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:3172` |
| 0.0% | 12.3ms | 0.0% | 59.0ms | `.wasm-function[176]` | `[native code]` |
| 0.0% | 12.2ms | 0.0% | 15.9ms | `collectPorts` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:206477` |
| 0.0% | 12.2ms | 0.0% | 12.2ms | `getOrCreateNetwork` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:161` |
| 0.0% | 12.0ms | 0.0% | 12.0ms | `getSubcircuitConnectivityKeyForId` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:304524` |
| 0.0% | 12.0ms | 0.0% | 12.0ms | `243` | `[native code]` |
| 0.0% | 12.0ms | 0.0% | 12.0ms | `getProcedure` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:145909` |
| 0.0% | 11.9ms | 0.0% | 22.0ms | `lessThan` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:14831` |
| 0.0% | 11.9ms | 0.0% | 32.0ms | `performProxyObjectGet` | `[native code]` |
| 0.0% | 11.9ms | 0.1% | 641.9ms | `traceHasEndpointMatchingConnectionSelector` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:355751` |
| 0.0% | 11.9ms | 0.0% | 19.6ms | `componentName` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:147961` |
| 0.0% | 11.8ms | 0.0% | 11.8ms | `Error` | `[native code]` |
| 0.0% | 11.7ms | 0.3% | 2.12s | `getSimpleRouteJsonFromCircuitJson` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:340331` |
| 0.0% | 11.7ms | 0.0% | 12.9ms | `Arc` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:15563` |
| 0.0% | 11.6ms | 0.0% | 11.6ms | `_parse` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 11.6ms | 0.0% | 11.6ms | `Renderable` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:146865` |
| 0.0% | 11.5ms | 0.0% | 11.5ms | `runRenderPhase` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:147007` |
| 0.0% | 11.5ms | 0.0% | 11.5ms | `_parse` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/node_modules/zod/v3/types.js` |
| 0.0% | 11.5ms | 0.0% | 11.5ms | `__emval_invoke` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 11.4ms | 0.0% | 11.4ms | `getDescendantSubcircuitIds2` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:304419` |
| 0.0% | 11.3ms | 0.0% | 304.1ms | `parseSelector` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:145835` |
| 0.0% | 11.3ms | 0.0% | 11.3ms | `/\s+/g` | `[native code]` |
| 0.0% | 11.2ms | 0.0% | 73.1ms | `.wasm-function[80]` | `[native code]` |
| 0.0% | 11.1ms | 0.2% | 1.41s | `add` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:14752` |
| 0.0% | 11.1ms | 0.0% | 11.1ms | `getFullConnectivityMapFromCircuitJson` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:296` |
| 0.0% | 11.0ms | 0.0% | 11.0ms | `/(?:^\|\s)pin6(?:$\|\s)/` | `[native code]` |
| 0.0% | 11.0ms | 0.0% | 13.1ms | `toString` | `[native code]` |
| 0.0% | 10.9ms | 0.0% | 294.9ms | `recalc_max` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:12880` |
| 0.0% | 10.7ms | 0.0% | 10.7ms | `RegisteredPointer_fromWireType` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:302277` |
| 0.0% | 10.6ms | 0.0% | 10.6ms | `getOrCreateRoutingPhasePlan` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 10.6ms | 0.0% | 10.6ms | `_parse` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/node_modules/zod/v3/types.js:3175` |
| 0.0% | 10.5ms | 0.0% | 10.5ms | `cju` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:16672` |
| 0.0% | 10.5ms | 0.0% | 10.5ms | `Vector` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 10.4ms | 0.0% | 11.4ms | `next` | `[native code]` |
| 0.0% | 10.3ms | 0.0% | 12.5ms | `preprocessSelector` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:147908` |
| 0.0% | 10.3ms | 0.0% | 53.1ms | `distanceTo` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:14857` |
| 0.0% | 10.2ms | 0.0% | 13.9ms | `.wasm-function[134]` | `[native code]` |
| 0.0% | 10.2ms | 0.0% | 28.4ms | `addConnections` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:210` |
| 0.0% | 10.2ms | 0.0% | 11.2ms | `reduceRules` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 10.2ms | 0.0% | 10.2ms | `processObstaclesForPour` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:304088` |
| 0.0% | 10.1ms | 0.0% | 223.1ms | `getTracePortPathSelectors` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:192076` |
| 0.0% | 10.1ms | 0.0% | 11.1ms | `Renderable` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:146864` |
| 0.0% | 10.1ms | 0.0% | 10.1ms | `getFullConnectivityMapFromCircuitJson` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:291` |
| 0.0% | 10.1ms | 0.0% | 10.1ms | `.wasm-function[257]` | `[native code]` |
| 0.0% | 9.9ms | 0.1% | 627.9ms | `insert` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:12796` |
| 0.0% | 9.9ms | 0.0% | 11.9ms | `.wasm-function[308]` | `[native code]` |
| 0.0% | 9.9ms | 0.0% | 14.4ms | `sort` | `[native code]` |
| 0.0% | 9.9ms | 0.0% | 53.9ms | `.wasm-function[222]` | `[native code]` |
| 0.0% | 9.9ms | 0.0% | 9.9ms | `ringToPathD` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/node_modules/circuit-to-svg/dist/index.js:978` |
| 0.0% | 9.8ms | 0.0% | 9.8ms | `update` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:17134` |
| 0.0% | 9.8ms | 0.0% | 9.8ms | `runRenderPhase` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:147021` |
| 0.0% | 9.8ms | 0.0% | 259.4ms | `intersectEdge2Polygon` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:11407` |
| 0.0% | 9.8ms | 0.0% | 9.8ms | `getNameAndAliases` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 9.7ms | 0.0% | 9.7ms | `compileToken` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:146749` |
| 0.0% | 9.7ms | 0.0% | 17.9ms | `normalizeRing` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:303592` |
| 0.0% | 9.7ms | 0.0% | 617.7ms | `flushSyncWorkAcrossRoots_impl` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:150839` |
| 0.0% | 9.6ms | 0.0% | 23.1ms | `getTracePathNetSelectors` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:192079` |
| 0.0% | 9.5ms | 0.0% | 9.5ms | `insert` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:17008` |
| 0.0% | 9.5ms | 0.0% | 46.7ms | `.wasm-function[437]` | `[native code]` |
| 0.0% | 9.5ms | 0.0% | 9.5ms | `tree_search_interval` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 9.5ms | 0.0% | 10.7ms | `_parse` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:4290` |
| 0.0% | 9.3ms | 0.0% | 9.3ms | `contains` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 9.3ms | 0.0% | 11.6ms | `selectAll` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:148731` |
| 0.0% | 9.2ms | 0.0% | 9.2ms | `getCopperPourConnectivity` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:162329` |
| 0.0% | 9.2ms | 0.0% | 488.3ms | `_parse` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:3176` |
| 0.0% | 9.2ms | 0.0% | 9.2ms | `Matrix` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:12563` |
| 0.0% | 9.2ms | 0.0% | 67.9ms | `.wasm-function[668]` | `[native code]` |
| 0.0% | 9.1ms | 0.0% | 9.1ms | `escapeRegex` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:145953` |
| 0.0% | 9.1ms | 0.0% | 9.1ms | `getParent` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:147783` |
| 0.0% | 9.1ms | 0.0% | 9.1ms | `(anonymous)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/node_modules/circuit-to-svg/dist/index.js:1513` |
| 0.0% | 9.0ms | 0.0% | 9.0ms | `runRenderPhase` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:147020` |
| 0.0% | 9.0ms | 0.0% | 258.7ms | `compileToken` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:146728` |
| 0.0% | 9.0ms | 0.0% | 9.0ms | `multiply` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 9.0ms | 0.5% | 3.50s | `flatIntoArrayWithCallback` | `[native code]` |
| 0.0% | 8.9ms | 0.0% | 409.0ms | `_parseSync` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/node_modules/zod/v3/types.js:100` |
| 0.0% | 8.9ms | 0.0% | 8.9ms | `/\s*>\s*/g` | `[native code]` |
| 0.0% | 8.8ms | 0.0% | 8.8ms | `getFullConnectivityMapFromCircuitJson` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:288` |
| 0.0% | 8.8ms | 0.0% | 13.2ms | `Trace__findConnectedPorts` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:187186` |
| 0.0% | 8.8ms | 0.0% | 21.8ms | `.wasm-function[137]` | `[native code]` |
| 0.0% | 8.8ms | 0.0% | 8.8ms | `cachedDescendant` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:146624` |
| 0.0% | 8.8ms | 0.0% | 17.6ms | `.wasm-function[220]` | `[native code]` |
| 0.0% | 8.7ms | 24.8% | 155.06s | `(anonymous)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:187128` |
| 0.0% | 8.6ms | 0.1% | 873.0ms | `compileToken` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:146738` |
| 0.0% | 8.6ms | 0.0% | 8.6ms | `parse` | `[native code]` |
| 0.0% | 8.6ms | 0.0% | 8.6ms | `stringify` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/node_modules/svgson/dist/svgson.cjs.js:108` |
| 0.0% | 8.4ms | 0.0% | 9.5ms | `getSimpleRouteJsonFromCircuitJson` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:340723` |
| 0.0% | 8.4ms | 0.0% | 26.6ms | `buildSubtree` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:16542` |
| 0.0% | 8.3ms | 0.0% | 15.5ms | `convertCircuitJsonToInputProblem` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:304573` |
| 0.0% | 8.3ms | 0.0% | 9.3ms | `append` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:16054` |
| 0.0% | 8.3ms | 0.0% | 8.3ms | `selectNetByLiteralSelector` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:144515` |
| 0.0% | 8.3ms | 0.0% | 11.4ms | `ry2` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:260799` |
| 0.0% | 8.2ms | 0.0% | 8.2ms | `getName` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 8.2ms | 0.0% | 8.2ms | `assertFinitePoint` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 8.2ms | 0.0% | 8.2ms | `search` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:12839` |
| 0.0% | 8.2ms | 0.0% | 29.9ms | `.wasm-function[541]` | `[native code]` |
| 0.0% | 8.2ms | 0.0% | 8.2ms | `668` | `[native code]` |
| 0.0% | 8.1ms | 24.8% | 155.14s | `doInitialCreateAutoplacedBreakoutPoints` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:368457` |
| 0.0% | 8.0ms | 0.0% | 9.0ms | `includesScopePseudo` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 8.0ms | 0.3% | 2.21s | `processObstaclesForPour` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:304058` |
| 0.0% | 8.0ms | 0.0% | 8.0ms | `getParsedType` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 8.0ms | 0.0% | 8.0ms | `[Symbol.iterator]` | `[native code]` |
| 0.0% | 8.0ms | 0.0% | 8.0ms | `findAll` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:147858` |
| 0.0% | 7.8ms | 0.0% | 7.8ms | `_processInputParams` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/node_modules/zod/v3/types.js:88` |
| 0.0% | 7.8ms | 58.7% | 366.59s | `Group_getRoutingPhasePlans` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:355879` |
| 0.0% | 7.8ms | 0.0% | 7.8ms | `buildSubtree` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:16537` |
| 0.0% | 7.8ms | 0.0% | 12.4ms | `.wasm-function[446]` | `[native code]` |
| 0.0% | 7.8ms | 0.0% | 7.8ms | `(anonymous)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:192079` |
| 0.0% | 7.7ms | 0.0% | 7.7ms | `equalTo` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 7.7ms | 0.0% | 7.7ms | `fromWireType` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 7.7ms | 0.0% | 7.7ms | `_getTracePortOrNetSelectorListFromProps` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:192066` |
| 0.0% | 7.7ms | 0.0% | 7.7ms | `transform` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 7.6ms | 0.0% | 7.6ms | `getDescendantSubcircuitIds2` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:304403` |
| 0.0% | 7.5ms | 0.0% | 7.5ms | `getDescendantSubcircuitIds2` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:304406` |
| 0.0% | 7.5ms | 0.0% | 7.5ms | `test` | `[native code]` |
| 0.0% | 7.4ms | 0.1% | 764.6ms | `bound readPointer` | `[native code]` |
| 0.0% | 7.3ms | 0.0% | 7.3ms | `(anonymous)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/node_modules/circuit-to-svg/dist/index.js:10688` |
| 0.0% | 7.3ms | 0.0% | 7.3ms | `buildSubcircuitConnectivityLookup` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:304473` |
| 0.0% | 7.3ms | 0.0% | 7.3ms | `getWhere` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 7.3ms | 0.0% | 26.4ms | `processObstaclesForPour` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:304089` |
| 0.0% | 7.3ms | 0.0% | 10.8ms | `insert` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:17020` |
| 0.0% | 7.2ms | 0.0% | 7.2ms | `processObstaclesForPour` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:304055` |
| 0.0% | 7.2ms | 0.0% | 7.2ms | `slice` | `[native code]` |
| 0.0% | 7.2ms | 0.0% | 37.7ms | `distanceToPoint` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:15191` |
| 0.0% | 7.1ms | 0.0% | 7.1ms | `ZodType` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/node_modules/zod/v3/types.js:267` |
| 0.0% | 7.1ms | 0.0% | 7.1ms | `findConnectedNetworks` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:173` |
| 0.0% | 7.1ms | 0.0% | 13.8ms | `visit` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:357676` |
| 0.0% | 7.0ms | 0.0% | 32.3ms | `buildSubtree` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:16536` |
| 0.0% | 7.0ms | 0.0% | 7.0ms | `getWasmTableEntry` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:302367` |
| 0.0% | 6.9ms | 0.0% | 6.9ms | `getCopperPourConnectivity` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:162355` |
| 0.0% | 6.9ms | 0.0% | 6.9ms | `getSimpleRouteJsonFromCircuitJson` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:340340` |
| 0.0% | 6.8ms | 0.0% | 70.4ms | `processObstaclesForPour` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:304067` |
| 0.0% | 6.8ms | 0.0% | 226.5ms | `.wasm-function[936]` | `[native code]` |
| 0.0% | 6.8ms | 0.0% | 6.8ms | `compileToken` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:146731` |
| 0.0% | 6.8ms | 0.0% | 30.6ms | `(anonymous)` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/node_modules/svgson/dist/svgson.cjs.js:84` |
| 0.0% | 6.8ms | 0.0% | 6.8ms | `939` | `[native code]` |
| 0.0% | 6.8ms | 0.0% | 10.4ms | `point2segment` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:13459` |
| 0.0% | 6.8ms | 0.0% | 32.7ms | `.wasm-function[123]` | `[native code]` |
| 0.0% | 6.7ms | 0.0% | 24.5ms | `getDescendants` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:148814` |
| 0.0% | 6.7ms | 0.0% | 6.7ms | `Renderable` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js` |
| 0.0% | 6.7ms | 0.0% | 8.0ms | `.wasm-function[439]` | `[native code]` |
| 0.0% | 6.7ms | 0.0% | 6.7ms | `getIdsConnectedToNet` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:235` |
| 0.0% | 6.6ms | 4.4% | 28.07s | `getChildren` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:147894` |
| 0.0% | 6.6ms | 0.0% | 6.6ms | `_parse` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:3174` |
| 0.0% | 6.6ms | 0.0% | 6.6ms | `Group_getRoutingPhasePlans` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:356013` |
| 0.0% | 6.6ms | 0.0% | 6.6ms | `Group_getRoutingPhasePlans` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:355876` |
| 0.0% | 6.5ms | 0.8% | 5.06s | `toVec` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:300824` |
| 0.0% | 6.5ms | 0.0% | 6.5ms | `buildSubcircuitConnectivityLookup` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:304486` |
| 0.0% | 6.5ms | 0.0% | 6.5ms | `get config` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:357331` |
| 0.0% | 6.5ms | 0.0% | 15.9ms | `Segment` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:15028` |
| 0.0% | 6.5ms | 0.7% | 4.80s | `runManifoldOperation` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/patched-core/index.js:303638` |
| 0.0% | 6.4ms | 0.0% | 6.4ms | `createSvgObjectsFromSmtPad` | `/home/runner/_work/tscircuit-autorouter/tscircuit-autorouter/experiments/full-board-priority-analysis/node_modules/circuit-to-svg/dist/index.js:1559` |
| 0.0% | 6.4ms | 0.
