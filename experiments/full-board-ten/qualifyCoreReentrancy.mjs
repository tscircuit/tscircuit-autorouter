import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import vm from 'node:vm'
const ts = (await import(process.argv[3] ?? 'typescript')).default
import { join } from 'node:path'
const root = process.argv[2]
if (!root) throw Error('Expected isolated qualification root')
const sha = b => createHash('sha256').update(b).digest('hex')
const corePath = join(root, 'npm/core/dist/index.js')
const chunkPath = join(root, 'npm/core/dist/chunk-MS7QPCOY.js')
const core = readFileSync(corePath, 'utf8')
const chunk = readFileSync(chunkPath, 'utf8')
assert.equal(sha(core), '53798b0d37ae966acca93e503de4d20e6bb98086d9ec27313646030c364ec519')
assert.equal(sha(chunk), '7ac2d30da88918e7faa8fcfb7770e25321bbbec3edcf7b2e4cdc21713e54a24a')
const ast = (s,n) => ts.createSourceFile(n,s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS)
const declarations = (s,n,names) => ast(s,n).statements.filter(st => ts.isVariableStatement(st) && st.declarationList.declarations.some(d => names.includes(d.name.getText()))).map(st => st.getText()).join('\n')
const renderable = declarations(chunk,'chunk.js',['orderedRenderPhases','renderPhaseIndexMap','asyncPhaseDependencies','globalRenderCounter','globalAsyncEffectCounter','Renderable'])
const isolated = declarations(core,'core.js',['IsolatedCircuit'])
assert.equal(renderable.includes('_queueAsyncEffect'),true)
assert.equal(isolated.includes('getCircuitJson()'),true)
const sourceClass = (text) => ts.createSourceFile('source.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).statements.find(s => ts.isClassDeclaration(s) && s.name?.text === 'Renderable')
const publishedClass = (text) => ast(text, 'chunk.js').statements.filter(ts.isVariableStatement).flatMap(s => s.declarationList.declarations).find(d => d.name.getText() === 'Renderable').initializer
const methodText = (owner) => owner.members.find(m => m.name?.getText() === '_queueAsyncEffect').getText()
const canonicalMethod = (method) => {
  const compiled = ts.transpileModule('class Check {' + method + '}', { compilerOptions: { target: ts.ScriptTarget.ESNext, removeComments: true } }).outputText
  const parsed = ast(compiled, 'method.js').statements[0].members[0].body
  const tree = (node) => {
    const children = []; ts.forEachChild(node, child => { children.push(tree(child)) })
    const text = 'text' in node ? (ts.isIdentifier(node) && node.text === 'root2' ? 'root' : node.text) : null
    return [node.kind, text, children]
  }
  return JSON.stringify(tree(parsed))
}
const candidateChunk = chunk.replace('promise: effect(),', 'promise: Promise.resolve().then(effect),')
for (const lane of ['base', 'candidate']) {
  const source = readFileSync(join(root, 'core-reentrancy', `Renderable.${lane}.ts`), 'utf8')
  const runtime = lane === 'base' ? chunk : candidateChunk
  assert.equal(canonicalMethod(methodText(sourceClass(source))), canonicalMethod(methodText(publishedClass(runtime))), `${lane} source/runtime queue method`)
}
async function run(readDuringStart, deferEffect = false, rejectEffect = false) {
  const rows = [], events=[], loggedErrors=[]
  const debug = ()=>{};debug.enabled=false
  const context=vm.createContext({console:{...console,error:(message)=>loggedErrors.push(String(message))},setTimeout,clearTimeout,debug,createCircuitJsonDatabase:()=>({toArray:()=>structuredClone(rows)}),structuredClone})
  const selectedRenderable = deferEffect ? renderable.replace('promise: effect(),', 'promise: Promise.resolve().then(effect),') : renderable
  assert.equal((renderable.match(/promise: effect\(\),/g)??[]).length,1)
  vm.runInContext(selectedRenderable+'\n'+isolated+'\nglobalThis.constructors={Renderable,IsolatedCircuit}',context)
  const {Renderable,IsolatedCircuit}=context.constructors
  const circuit=new IsolatedCircuit()
  let release,reject
  const held=new Promise((resolve,fail)=>{release=resolve;reject=fail})
  class OneHeldRoutingEffect extends Renderable {
    root=circuit
    started=false
    doInitialPcbTraceRender() {
      if(this.started)return
      this.started=true
      this._queueAsyncEffect('held-route',async()=>{
        events.push('routing callback starts')
        circuit.emit('autorouting:start',{})
        await held
        rows.push({type:'diagnostic_accepted_copper'})
        events.push('routing callback completes')
        this._markDirty('PcbTraceRender')
      })
    }
    doInitialPcbCopperPourRender() {
      rows.push({type:'diagnostic_pour',acceptedCopperPresent:rows.some(r=>r.type==='diagnostic_accepted_copper')})
      events.push('pour renders')
    }
  }
  const board=new OneHeldRoutingEffect({});circuit.firstChild=board;circuit.children=[board]
  if(readDuringStart)circuit.on('autorouting:start',()=>{
    events.push('listener reads getCircuitJson')
    circuit.getCircuitJson()
  })
  circuit.render()
  const immediatelyAfterRender={events:[...events],phase:circuit.getRunningAsyncEffects()[0]?.phase}
  await new Promise(resolve=>setTimeout(resolve,0))
  const pending={events:[...events],phase:circuit.getRunningAsyncEffects()[0]?.phase,pours:structuredClone(rows.filter(r=>r.type==='diagnostic_pour'))}
  if(rejectEffect)reject(new Error('intentional held-effect rejection'));else release()
  await held.catch(()=>{});await new Promise(resolve=>setTimeout(resolve,0))
  circuit.render()
  return {immediatelyAfterRender,pending,settled:{events,rows:structuredClone(rows),runningEffects:circuit.getRunningAsyncEffects().length,loggedErrors}}
}
const control=await run(false),getterListener=await run(true),candidate=await run(true,true),candidateRejection=await run(true,true,true),controlRejection=await run(false,false,true)
assert.equal(control.pending.phase,'PcbTraceRender')
assert.equal(control.pending.pours.length,0)
assert.equal(control.settled.rows.find(r=>r.type==='diagnostic_pour').acceptedCopperPresent,true)
assert.equal(getterListener.pending.phase,'SimulationSpiceEngineRender')
assert.equal(getterListener.pending.pours.length,1)
assert.equal(getterListener.pending.pours[0].acceptedCopperPresent,false)
assert.equal(getterListener.settled.rows.filter(r=>r.type==='diagnostic_pour').length,1)
assert.equal(getterListener.settled.rows.find(r=>r.type==='diagnostic_pour').acceptedCopperPresent,false)
assert.equal(candidate.immediatelyAfterRender.events.length,0)
assert.equal(candidate.pending.phase,'PcbTraceRender')
assert.equal(candidate.pending.pours.length,0)
assert.equal(candidate.settled.rows.find(r=>r.type==='diagnostic_pour').acceptedCopperPresent,true)
assert.equal(candidate.settled.runningEffects,0)
for(const row of [controlRejection,candidateRejection]){
 assert.equal(row.pending.phase,'PcbTraceRender')
 assert.equal(row.pending.pours.length,0)
 assert.equal(row.settled.runningEffects,0)
 assert.equal(row.settled.loggedErrors.length,1)
 assert(row.settled.loggedErrors[0].includes('intentional held-effect rejection'))
 assert(row.settled.loggedErrors[0].includes('PcbTraceRender'))
}
const proof={coreVersion:'0.0.2407',coreEntrySha256:sha(core),chunkSha256:sha(chunk),executedCode:'Exact published Renderable plus IsolatedCircuit declarations; stub DB and one held effect; no routing or pour solver',sourceMethodBodyEquality:['_queueAsyncEffect'],candidateChunkSha256:sha(candidateChunk),control,getterListener,candidate,candidateRejection,controlRejection,candidateChange:'promise: effect() -> promise: Promise.resolve().then(effect), one declaration only',nativeRoutingExecuted:false,assertionsPassed:true}
const output=join(root,'core-reentrancy/source-gate.json')
writeFileSync(output,JSON.stringify(proof,null,2)+'\n')
console.log(JSON.stringify(proof,null,2))
