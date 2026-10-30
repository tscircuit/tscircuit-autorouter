"""One pure two-parent source-publication contract test."""
import copy,importlib.util,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('v4_two_parent_contract',ROOT/'run-mst-relative-v4-84.py');r=importlib.util.module_from_spec(s);s.loader.exec_module(r)
def main():
 checks=[];q={'tree':r.TREE,'localCommit':r.SOURCE_LOCAL};pub={'remoteCommit':r.SOURCE,'tree':r.TREE,'qa':{'sha256':r.QA_SHA},'peer':{'sha256':r.REVIEW_SHA},'remoteCommitTreeParentsAndBranchGetVerified':True,'remoteParents':r.SOURCE_PARENTS,'readyForFreshCombinedSemantic84Source':True};assert r.validate_source_publication(q,pub)['twoParentPublicationAccurate'];checks.append('accurate-two-parent-source-publication')
 for label,mutate in[('old-single-parent-claim-only',lambda p:(p.pop('remoteCommitTreeParentsAndBranchGetVerified'),p.update(remoteCommitTreeSingleParentAndBranchGetVerified=True))),('contradictory-single-parent-claim',lambda p:p.update(remoteCommitTreeSingleParentAndBranchGetVerified=True)),('missing-relative-parent',lambda p:p.update(remoteParents=r.SOURCE_PARENTS[:1])),('wrong-parent-order',lambda p:p.update(remoteParents=list(reversed(r.SOURCE_PARENTS)))),('unreviewed-source-readiness',lambda p:p.update(readyForFreshCombinedSemantic84Source=False))]:
  altered=copy.deepcopy(pub);mutate(altered)
  try:r.validate_source_publication(q,altered)
  except ValueError:checks.append(label)
  else:raise AssertionError('Inaccurate source publication accepted')
 print(json.dumps({'status':'PASS_ACCURATE_TWO_PARENT_COMBINED_SOURCE_PUBLICATION','count':len(checks),'checks':checks,'networkRequests':0,'actualBoards':0}))
if __name__=='__main__':main()
