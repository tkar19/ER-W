import { LOCAL_COGNITIVE_PRINCIPLES, relevantKnownEvidence } from './local_cognition.mjs';

function clean(text){return String(text||'').trim().replace(/\s+/g,' ');}
function presentNpcs(publicState){
  const ids=new Set(publicState?.scene?.present_npc_ids||[]);
  return (publicState?.known_npcs||[]).filter(n=>ids.has(n.id));
}
function targetNpc(publicState,target){return (publicState?.known_npcs||[]).find(n=>n.id===target||String(n.name||'').toLowerCase()===String(target||'').toLowerCase())||null;}

export function assessLocalUnderstanding({analysis=null,intent=null,publicState=null,contextPacket=null}={}){
  if(!analysis)return null;
  const observations=[]; const uncertainties=[]; const constraints=[];
  const effectiveAction=analysis.action_type!=='OTHER'?analysis.action_type:(analysis.proposed_action_type||'OTHER');
  const present=presentNpcs(publicState); const target=targetNpc(publicState,analysis.target);
  if(publicState?.world?.location)observations.push(`Current visible location: ${publicState.world.location}.`);
  if(publicState?.combat)observations.push('The player character is currently in active combat.');
  if(publicState?.projects?.travel?.status==='active')observations.push(`Travel is already active toward ${publicState.projects.travel.target}.`);
  if(target){observations.push(`${target.name} is known to the player${present.some(n=>n.id===target.id)?' and currently present':''}.`);}
  if(analysis.target_resolution==='pronoun_ambiguous')uncertainties.push('The pronoun target cannot be resolved safely from visible context.');
  if(analysis.target_resolution==='ambiguous_active_context')uncertainties.push('More than one active process could be meant by the continuation request.');
  if(analysis.ambiguity_flags?.includes('missing_repeat_referent'))uncertainties.push('A repeat was requested, but no exact previous player-visible attempt can be recovered.');
  if(analysis.ambiguity_flags?.includes('unparsed_intent'))uncertainties.push('The local model cannot ground this instruction confidently enough to commit it as a world action.');
  if(analysis.interaction_mode==='clarification_needed')constraints.push('No world action should be committed until the ambiguous or ungrounded reference is resolved.');
  if(analysis.compound_action_hint)constraints.push('The input contains multiple voluntary world actions; only the primary action may be committed by this interpretation pass.');
  if(analysis.interaction_mode==='conditional_instruction')constraints.push('The stated condition has not itself authorized immediate execution of the future action.');
  if(analysis.interaction_mode==='planning_query')constraints.push('This is a planning question, not a committed world action.');
  if(analysis.interaction_mode==='meta_query')constraints.push('This is a runtime/meta question, not a committed world action.');
  if(analysis.interaction_mode==='non_action_statement')constraints.push('The player explicitly declined or negated an action.');
  if(analysis.interaction_mode==='belief_statement')constraints.push('The statement is a player belief, memory claim, assertion, or hypothesis; it must not become canon merely because it was stated.');
  if(analysis.interaction_mode==='past_report')constraints.push('The statement refers to a past event; it must not execute a new present action or rewrite committed history.');
  if(analysis.interaction_mode==='future_intent')constraints.push('The statement describes a future intention; it does not authorize execution now.');
  if(analysis.interaction_mode==='reasoning_query')constraints.push('An explanation may summarize player-known evidence but must not invent a hidden cause or promote correlation into causation.');
  if(analysis.correction_applied)constraints.push('The correction applies to the current interpretation only; already committed history remains unchanged.');
  if(effectiveAction==='TRAVEL'){
    const continuing=analysis.context_reference?.kind==='continuation';
    if(!intent?.target&&!analysis.target&&!continuing)uncertainties.push('Travel target is missing or could not be grounded.');
    if(!(Number(intent?.distance_km)>0)&&!continuing)uncertainties.push('Travel distance is not declared; the deterministic engine will not invent a route distance.');
  }
  if(effectiveAction==='TALK'&&!analysis.target&&present.length>1)uncertainties.push('Multiple visible NPCs are present and no unique conversation target was grounded.');
  if(effectiveAction==='COMBAT'&&!analysis.target&&present.length>1)uncertainties.push('Multiple visible NPCs are present and no unique combat target was grounded.');
  if(effectiveAction==='MAGIC'){
    const mana=Number(publicState?.pc?.magic?.mana); if(Number.isFinite(mana)) observations.push(`Visible magical reserve: ${mana}/${publicState.pc.magic.max_mana}.`);
  }
  const recent=(contextPacket?.items||[]).slice(0,4).map(e=>clean(e.summary)).filter(Boolean);
  const epistemic=analysis.epistemic?(()=>{
    const relevant=relevantKnownEvidence(analysis.epistemic.claim,publicState,contextPacket);
    const conflicts=relevant.filter(x=>x.conflict).map(x=>({kind:x.kind,id:x.id,text:x.text,overlap:x.overlap,reason:x.conflict.reason}));
    return {
      kind:analysis.epistemic.kind,
      certainty:analysis.epistemic.certainty,
      claim:analysis.epistemic.claim,
      status:'unverified_player_proposition',
      relevant_known_information:Object.freeze(relevant.map(x=>Object.freeze({kind:x.kind,id:x.id,text:x.text,overlap:x.overlap}))),
      potential_conflicts:Object.freeze(conflicts.map(x=>Object.freeze(x))),
    };
  })():null;
  const causal=analysis.causal?(()=>{
    const relevant=relevantKnownEvidence(analysis.causal.subject,publicState,contextPacket,{limit:6});
    return {
      question:analysis.causal.source_text,
      subject:analysis.causal.subject,
      status:relevant.length?'evidence_available_not_necessarily_causal':'cause_not_established_from_known_state',
      evidence:Object.freeze(relevant.map(x=>Object.freeze({kind:x.kind,id:x.id,text:x.text,overlap:x.overlap}))),
    };
  })():null;
  return Object.freeze({
    version:'ERGPT_EXT_LOCAL_REASONER_0.3', authority:'derived_advisory_only', interaction_mode:analysis.interaction_mode,
    primary_action_type:analysis.action_type, proposed_action_type:analysis.proposed_action_type||null,
    confidence_band:analysis.learned?.confidence_band||'none', observations:Object.freeze(observations),
    uncertainties:Object.freeze(uncertainties), constraints:Object.freeze(constraints), recent_relevant_events:Object.freeze(recent),
    epistemic_assessment:epistemic?Object.freeze(epistemic):null,
    causal_assessment:causal?Object.freeze(causal):null,
    temporal_assessment:analysis.temporal?Object.freeze({...analysis.temporal,status:'non_executing_temporal_reference'}):null,
    cognitive_principles:LOCAL_COGNITIVE_PRINCIPLES,
  });
}
