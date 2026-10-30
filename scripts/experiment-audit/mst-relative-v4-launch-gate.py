"""Prospective launch prerequisite: exact original MST plus actual relativeV4 repair."""
import hashlib,json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parent
MST_SOURCE='5d5500e3da02a7b1ed3eec74fc262f31c04f47df'
EXCLUDED_STABLE='087075c2dbb9a96e1d1a1a5a2eb43b5f8b2326d2'
INVENTORY_SHA='c35b6eeb825aad5b02f5aa5e7c0072d06e752b65fa466a009ae690e5e446b535'
MST18_ZIP='f2932c4d29d4914e744385f4b02c4f0180b1118471f6eb2b661915f619d68624'
MST18_INPUTS={'original-input.json':'cd9924beb5b920ef32079e11945de2719d5514bf0d40f443c2ad677aa3ac53e2','point-pair-context.json':'15467fae6ad5d927beaf25f28cff5a3820c5cb283de0818eb75509129cc5a8f1','raw-new-traces.json':'880216e518f24c0c40269b6e28fe5e35146eb1cbef4eb6d5fe63a0f37d81bb44'}
P9='lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/'
RELATIVE_SOURCE='f5d60ecabaf3850758f392f26c86dc450b986fc6'
RELATIVE_TREE='1f79010eacfa320bf3f53bb9ea5be9f01d740211'
RELATIVE_FILES={'viaTraceTargets':P9+'getRelativeViaTraceTargets.ts','detailGetter':P9+'getPipeline9RelativeGeometryDetails.ts','preservation':P9+'preservePipeline9RelativeFindings.ts','targetClearance':P9+'checkPipeline9RelativeViaTraceClearance.ts','stage':P9+'Pipeline9RelativeWitnessRepairSolver.ts','proof':P9+'provePipeline9RelativeContacts.ts','geometry':P9+'relativeCopperSweepGeometry.ts','certificate':P9+'getPipeline9WitnessViaCertificate.ts'}
CHECKS={'viaPad','padTrace','viaTrace','traceOverlap','differentNetViaSpacing','sameNetViaSpacing','padPad'}
def digest(value,n=64):return isinstance(value,str)and re.fullmatch(r'[0-9a-f]{'+str(n)+'}',value)is not None
def require(value,message):
 if not value:raise ValueError(message)
def integer(value):return type(value)is int and value>=0
def same(a,b):return json.dumps(a,sort_keys=True,separators=(',',':'))==json.dumps(b,sort_keys=True,separators=(',',':'))
def original_inventory():
 p=ROOT/'mst-relative-v4-original-mst-source-inventory.json';require(hashlib.sha256(p.read_bytes()).hexdigest()==INVENTORY_SHA,'Original MST implementation inventory bytes changed');v=json.loads(p.read_bytes());require(v['originalMstSourceSha']==MST_SOURCE and v['excludedStableSourceSha']==EXCLUDED_STABLE and len(v['files'])==8,'Original MST composition scope changed');return v

def validate_stage_documents(gate,raw,peer,raw_sha,peer_sha):
 require(gate.get('schemaVersion')==1 and gate.get('status')=='PASS_NEW_RETAINED18_RELATIVE_V4_LOCAL_REPAIR_PREREQUISITE','New retained18V4 production gate is unqualified')
 require(gate.get('case')=='srj18:11'and gate.get('originalMstSourceSha')==MST_SOURCE and gate.get('excludedStableSourceSha')==EXCLUDED_STABLE,'Wrong original-MST/retained18 prerequisite')
 require(digest(raw_sha)and digest(peer_sha)and gate.get('rawQualificationSha256')==raw_sha and gate.get('independentReviewSha256')==peer_sha,'Stage qualification/independent receipt bytes unbound')
 require(str(raw.get('status','')).startswith('PASS_')and str(peer.get('status','')).startswith('PASS_'),'Actual retained production stage and independent raw approval required')
 require(peer.get('authorQualification',{}).get('sha256')==raw_sha,'Independent actual stage review does not bind these owner bytes')
 require(raw.get('actualProductionStageClass')=='Pipeline9RelativeWitnessRepairSolver'and raw.get('actualProductionStageSolveCalls')==1 and raw.get('actualProductionStageStatus')=='LOCAL_REPAIRED'and raw.get('actualV4ProductionStagePositiveGatePassed')is True,'Actual productionV4 stage must locally repair retained18')
 require(integer(raw.get('actualProductionStageIterations'))and raw['actualProductionStageIterations']<=20 and type(raw.get('actualProductionStageAttemptedCandidates'))is int and 1<=raw['actualProductionStageAttemptedCandidates']<=16,'Unchanged stage iteration/candidate limits required')
 require(raw.get('pipelineRoutingExecuted')is False and raw.get('routingExecutions')==0,'Retained-stage proof must not reroute the selected board')
 require(raw.get('originalInputZipSha256')==MST18_ZIP and all(raw.get('exactInputMembers',{}).get(name,{}).get('sha256')==value for name,value in MST18_INPUTS.items()),'Stage must consume exact qualified originalMST18B input/pairs/raw bytes')
 require(raw.get('sourceSha')==gate.get('relativeV4SourceSha')==RELATIVE_SOURCE and raw.get('sourceTree')==gate.get('relativeV4SourceTree')==RELATIVE_TREE,'Actual tested relativeV4 published source missing')
 hashes=raw.get('sourceFileHashes');require(isinstance(hashes,dict)and set(hashes)==set(RELATIVE_FILES)and all(digest(value)for value in hashes.values())and same(gate.get('relativeImplementationHashes'),hashes),'All eight relative source components must bind actual18V4')
 before,after=raw.get('before',{}),raw.get('after',{});a,b=before.get('publishedCounts',{}),after.get('publishedCounts',{});require(set(a)==set(b)==CHECKS and all(integer(v)for v in[*a.values(),*b.values()])and all(a[key]==int(key=='viaTrace')and b[key]==0 for key in CHECKS),'Actual18 sole strict viaTrace target must improve to all-seven zero')
 for result in[before,after]:
  summary=result.get('summary',{});require(summary.get('status')=='UNKNOWN'and summary.get('demandsChecked')==139 and summary.get('reasonCount')==66 and summary.get('referenceErrorCount')==0 and summary.get('srjObstacleViolationCount')==6 and summary.get('viaPadPolicyViolationCount')==1 and summary.get('viaInPadViolationCount')==0 and summary.get('ownershipCoverageStatus')=='COMPLETE'and digest(result.get('fullCertificateSha256')),'Complete per-geometry old-body UNKNOWN139/66 and original untargeted6+1 findings must remain visible')
 require(raw.get('stageBeforeAndAfterFullReturnsEqualIndependentOldBodyReturns')is True and raw.get('acceptanceMode')=='EXACT_UNTARGETED_FINDINGS'and raw.get('geometryFindingsBefore')==8 and raw.get('geometryFindingsAfter')==7,'New localized8-to7 mode and complete independent old-body before/after equality required')
 contact=raw.get('independentBlacksmithRelativeReplay',{});require(raw.get('sourceRelativeProof',{}).get('status')=='PASS'and str(contact.get('status','')).startswith('PASS_')and contact.get('productionStageSolveCalls')==1 and contact.get('sameOwnerOriginalTerminalPartitionsPreservedConditionally')is True and contact.get('fullRawAndCanonicalProtectedMasksVerified')is True and contact.get('coupledViaAliasesVerified')is True,'Source and independent Blacksmith Fraction contact/mutation proof required')
 preservation=raw.get('independentUntargetedPreservation',{});require(preservation.get('status')=='PASS_EXACT_UNTARGETED_FINDING_PRESERVATION'and preservation.get('sourceDetailsMatchIndependentOldBodyRecords')is True and preservation.get('globalCertificateStatus')=='UNKNOWN'and preservation.get('globalDemandCount')==139 and preservation.get('globalReasonCount')==66 and preservation.get('beforeGeometryFindingCount')==8 and preservation.get('afterGeometryFindingCount')==7,'Independent complete untargeted record preservation proof required')
 expected={'nativeErrors':0,'nativeErrorsWithCenters':0,'nativeLocationAwareErrors':0,'viaInPad':0,'srjObstacles':6,'viaPadPolicy':1,'boardReasons':0};rows=preservation.get('completeUntargetedCollections');require(isinstance(rows,list)and len(rows)==7 and len({row.get('predicate')for row in rows})==7 and{row.get('predicate'):row.get('records')for row in rows}==expected and all(digest(row.get('multisetSha256'))for row in rows),'All seven full untargeted finding multisets with exact populations required')
 margin=raw.get('independentLiteralTargetClearance',{});witnesses=margin.get('segmentWitnesses');require(margin.get('status')=='PASS_LITERAL_TARGET_CLEARANCE_ALL_MANUFACTURED_LAYERS'and margin.get('literalMinimumClearanceMm')==.1 and margin.get('manufacturedLayers')==['top','inner1','inner2','bottom']and type(margin.get('segmentsChecked'))is int and margin['segmentsChecked']>0 and isinstance(witnesses,list)and len(witnesses)==margin['segmentsChecked']and all(row.get('literalMinimumClearancePassed')is True for row in witnesses),'Exact literal .1mm clearance to EVERY full-manufactured-layer foreign segment required')
 require(raw.get('fullGlobalCertificateStatus')=='UNKNOWN'and all(raw.get(key)is False for key in['accepted','fullBoardRecovery','qualityOrSpeedCredit','absoluteExistingGlobalConnectivityCertified']),'Local retained proof cannot promote full UNKNOWN or pool claims')
 require(gate.get('fullGlobalCertificateStatus')=='UNKNOWN'and gate.get('newFull84Ready')is True and gate.get('priorBaselineOrTimingReuse')is False,'Gate cannot promote local proof or pool prior clocks')
 return {'status':'QUALIFIED_RETAINED18_V4_PREREQUISITE','relativeImplementationHashes':hashes,'relativeV4SourceSha':raw['sourceSha'],'independentLocalContactProofFromRetainedStageOnly':True,'literalAllForeignSegmentsMarginProvenOnRetainedStageOnly':True,'newFull84OutputProofStillRequired':True}

def verify_composition(checkout,item,stage_gate):
 root=Path(checkout);inventory=original_inventory();require(item.get('originalMstSourceSha')==MST_SOURCE and item.get('excludedStableSourceSha')==EXCLUDED_STABLE,'Original MST/stable exclusion not explicit')
 expected={row['path']:row['sha256']for row in inventory['files']};require(same(item.get('requiredOriginalMstFileHashes'),expected),'Manifest original MST implementation inventory differs')
 relative={RELATIVE_FILES[key]:value for key,value in stage_gate['relativeImplementationHashes'].items()};require(same(item.get('requiredRelativeV4FileHashes'),relative),'Manifest relativeV4 implementation inventory differs from actual18')
 for name,value in{**expected,**relative}.items():require(hashlib.sha256((root/name).read_bytes()).hexdigest()==value,'Published candidate component bytes changed: '+name)
 return {'originalMstFileCount':8,'relativeV4FileCount':8,'exactComponentImplementationBytes':True}
