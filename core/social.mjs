import { clamp, sha256 } from './util.mjs';
import { relationship, proposeNpcDecision, socialResponseOptions, addBelief, ensureNpcCognition } from './cognition.mjs';

export function socialResistance(npc, intentType='request') {
  ensureNpcCognition(npc);
  const will = Number(npc.attributes?.Will || 0);
  const insight = Number(npc.skills?.Insight || npc.skills?.Perception || 0);
  const base = 10 + will + insight;
  const goalConflict = npc.adaptive?.goals?.some(g => g.status==='active' && g.protected === true) ? 2 : 0;
  return base + goalConflict + (intentType==='intimidate' ? Number(npc.traits?.courage || 0) : 0);
}

export function leverageValue(leverage = []) {
  return clamp((leverage || []).reduce((sum,x)=>sum + clamp(Number(x.strength || 0),-2,2),0),-4,4);
}

export function pressureFromOutcome(outcome, leverage=0) {
  const base={exceptional_success:4,success:3,mixed:1,failure:0,severe_failure:-1}[outcome] ?? 0;
  return clamp(base + leverage,-4,8);
}

export function resolveNpcSocialChoice(npc,state,{outcome,request={},leverage=[]}) {
  const pressure=pressureFromOutcome(outcome,leverageValue(leverage));
  const proposal=proposeNpcDecision(npc,state,socialResponseOptions(npc,request,pressure));
  if (proposal.option_id) {
    npc.adaptive.intention={option_id:proposal.option_id,action:proposal.action,target_id:'pc_1',source:'social_response',set_generation:state.meta.generation+1};
    npc.scheduler.next_decision_absolute_minute=proposal.next_review_absolute_minute;
  }
  return {pressure,proposal,grants_decision:false};
}

export function applySocialAftermath(npc,{kind='request',outcome,sourceEventId,truthful=true}) {
  const rel=relationship(npc,'pc_1');
  if (kind==='intimidate' && ['success','exceptional_success'].includes(outcome)) {
    rel.fear=clamp(rel.fear+8,-100,100); rel.trust=clamp(rel.trust-4,-100,100);
  }
  if (kind==='deception' && truthful===false && outcome==='severe_failure') rel.trust=clamp(rel.trust-8,-100,100);
  if (sourceEventId && !rel.provenance.includes(sourceEventId)) rel.provenance.push(sourceEventId);
  return rel;
}

function contradictsStrongEvidence(npc, proposition) {
  const p=String(proposition||'').trim().toLowerCase();
  if (!p) return false;
  return (npc.adaptive?.beliefs||[]).some(b=>
    String(b.proposition||'').trim().toLowerCase()===p &&
    ['false','rejected','contradicted'].includes(String(b.stance||'').toLowerCase()) &&
    Number(b.confidence||0)>=0.8
  );
}

export function applyDeceptionBelief(npc,{proposition,outcome,communicationEventId,generation=0}) {
  ensureNpcCognition(npc);
  if (!communicationEventId) throw new Error('Deception belief update requires a communication provenance event.');
  if (!npc.adaptive.known_event_ids.includes(communicationEventId)) npc.adaptive.known_event_ids.push(communicationEventId);
  if (!['success','exceptional_success','mixed'].includes(outcome)) return {updated:false,reason:'insufficient_positive_pressure'};
  if (contradictsStrongEvidence(npc,proposition)) return {updated:false,reason:'strong_contradictory_evidence'};
  const belief_id=`belief_${sha256({npc:npc.id,proposition,communicationEventId}).slice(0,18)}`;
  if (npc.adaptive.beliefs.some(b=>b.belief_id===belief_id)) return {updated:false,reason:'already_recorded'};
  const confidence=outcome==='exceptional_success'?0.8:outcome==='success'?0.65:0.5;
  const belief=addBelief(npc,{belief_id,proposition:String(proposition),stance:'believed',confidence,source_event_ids:[communicationEventId],last_update_generation:generation});
  return {updated:true,belief};
}

export function ensureAgreementStore(state) {
  state.agreements ||= {};
  return state.agreements;
}

export function createAgreement(state,{parties,terms,sourceEventId,acceptedBy=[]}) {
  if (!Array.isArray(parties)||parties.length<2) throw new Error('Agreement requires at least two parties.');
  const unique=[...new Set(parties)];
  if (acceptedBy.some(id=>!unique.includes(id))) throw new Error('Only a party can accept an agreement.');
  const agreement_id=`agr_${sha256({campaign:state.meta.campaign_id,generation:state.meta.generation+1,parties:unique,terms,sourceEventId}).slice(0,18)}`;
  const rec={agreement_id,parties:unique,terms:String(terms||''),accepted_by:[...new Set(acceptedBy)],source_event_id:sourceEventId||null,status:'proposed',committed_generation:null};
  if (rec.accepted_by.length===rec.parties.length) {rec.status='accepted';rec.committed_generation=state.meta.generation+1;}
  ensureAgreementStore(state)[agreement_id]=rec;
  return rec;
}

export function acceptAgreement(state,agreementId,partyId) {
  const rec=ensureAgreementStore(state)[agreementId];
  if (!rec) throw new Error('Unknown agreement.');
  if (!rec.parties.includes(partyId)) throw new Error('Only a party can accept an agreement.');
  if (!rec.accepted_by.includes(partyId)) rec.accepted_by.push(partyId);
  if (rec.accepted_by.length===rec.parties.length) {rec.status='accepted';rec.committed_generation=state.meta.generation+1;}
  return rec;
}
