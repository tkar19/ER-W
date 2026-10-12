import { assessLocalUnderstanding } from './local_reasoner.mjs';
import { LOCAL_COGNITIVE_PRINCIPLES } from './local_cognition.mjs';

const OUTCOME_TEXT=Object.freeze({
  exceptional_success:'exceptional success', success:'success', mixed:'mixed result', failure:'failure', severe_failure:'severe failure',
  resolved_without_roll:'resolved action', infeasible:'infeasible attempt',
});

function clean(text){return String(text||'').trim().replace(/\s+/g,' ');}
function sentence(text){const s=clean(text); if(!s)return ''; return /[.!?]$/.test(s)?s:`${s}.`;}
function stableIndex(seed,count){let h=2166136261;for(const c of String(seed||'')){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return Math.abs(h>>>0)%count;}
function actionLead(action,target,seed=''){
  const t=target?` ${target}`:'';
  const variants={
    LOOK:['You take in the immediate scene','You look over your surroundings','You pause to observe what is presently visible'],
    INVESTIGATE:[`You investigate${t}`,`You examine${t||' the subject'} more closely`,`You begin a deliberate search${t?` focused on ${target}`:''}`],
    TALK:[`You address${t||' the person in front of you'}`,`You speak${target?` to ${target}`:''}`,`You open the exchange${target?` with ${target}`:''}`],
    TRAVEL:[`You set out${target?` toward ${target}`:''}`,`You begin moving${target?` toward ${target}`:''}`,`You proceed${target?` toward ${target}`:''}`],
    MAGIC:['You attempt the magic','You shape the intended spell','You commit to the magical working'],
    WAIT:['You wait','You remain in place as time passes','You hold position and let time pass'],
    REST:['You rest','You settle down to recover','You take time to recuperate'],
    COMBAT:[`You commit to the combat action${t}`,`You engage in the declared combat action${t}`,`You carry through the declared combat move${t}`],
    STEALTH:['You move with stealth','You commit to the covert approach','You try to remain unnoticed'],
    CRAFT:[`You work on the craft or repair${t}`,`You begin practical work${t?` on ${target}`:''}`,`You continue the declared crafting work${t}`],
    OTHER:['You carry out the attempt','The input is committed as a general action','You proceed with the declared attempt'],
  };
  const list=variants[action]||variants.OTHER; return list[stableIndex(seed,list.length)];
}
function chosenEvents(events,simulationBriefing){
  if(simulationBriefing?.selected_events?.length) return simulationBriefing.selected_events.map(x=>x.event);
  return (events||[]).filter(e=>Array.isArray(e.known_by)&&(e.known_by.includes('pc_1')||e.known_by.includes('public')));
}
function uniqueSummaries(events){
  const seen=new Set(), out=[];
  for(const e of events){
    if(['turn_committed','resolution_audit','intent_interpreted','non_action_interaction'].includes(e.type)) continue;
    const s=clean(e.summary); if(!s)continue;
    const k=s.toLowerCase(); if(seen.has(k))continue; seen.add(k); out.push(sentence(s));
  }
  return out;
}
function npcSummary(npc){return {id:npc.id,name:npc.name,role:npc.role,location:npc.location,visible_condition:npc.visible_condition||null};}
function presentNpcNames(publicState){
  const ids=new Set(publicState?.scene?.present_npc_ids||[]); return (publicState?.known_npcs||[]).filter(n=>ids.has(n.id)).map(n=>n.name).filter(Boolean);
}
function answerWorldQuery(playerInput,publicState){
  const l=String(playerInput||'').toLowerCase();
  if(/where am i/.test(l))return `You are at ${publicState?.world?.location||'the currently committed location'}.`;
  if(/what time is it/.test(l))return `The current world time is ${publicState?.world?.time_label||'not available in the player-safe state'}.`;
  if(/who(?:'s| is) here/.test(l)){const names=presentNpcNames(publicState);return names.length?`Currently present and known to you: ${names.join(', ')}.`:'No known NPC is currently listed as present.';}
  if(/what (?:do|can) i see|what(?:'s| is) around me/.test(l)){const names=presentNpcNames(publicState);const scene=clean(publicState?.scene?.summary);return `${scene||`You are at ${publicState?.world?.location||'the current location'}.`}${names.length?` Present: ${names.join(', ')}.`:''}`;}
  if(/what am i carrying/.test(l)){const items=Object.values(publicState?.inventory?.items||{}).map(i=>i.name).filter(Boolean);return items.length?`You are carrying: ${items.join(', ')}.`:'No carried items are listed in the player-safe state.';}
  if(/mana/.test(l))return `Your visible magical reserve is ${publicState?.pc?.magic?.mana??'unknown'}/${publicState?.pc?.magic?.max_mana??'unknown'}.`;
  if(/coin/.test(l))return `You currently have ${publicState?.resources?.coin??0} coin.`;
  if(/rations|food/.test(l))return `You currently have ${publicState?.resources?.rations??0} rations.`;
  if(/water/.test(l))return `You currently have ${publicState?.resources?.water??0} water.`;
  return clean(publicState?.scene?.summary)||`You are at ${publicState?.world?.location||'the current location'}.`;
}

export function buildLocalSystemDigest(publicState,contextPacket=null){
  if(!publicState) return null;
  const presentIds=new Set(publicState.scene?.present_npc_ids||[]);
  const knownNpcs=(publicState.known_npcs||[]).filter(n=>presentIds.has(n.id)).slice(0,12).map(npcSummary);
  const recentKnown=(contextPacket?.items||[]).slice(0,10).map(e=>({id:e.id,type:e.type,summary:e.summary,entity_ids:e.entity_ids||[],location_id:e.location_id||null}));
  return {
    authority:'derived_player_safe_digest', version:'ERGPT_EXT_LOCAL_SYSTEM_DIGEST_0.4',
    world:{time_label:publicState.world?.time_label||null,location:publicState.world?.location||null,weather:publicState.world?.weather||null,known_facts:(publicState.world?.known_facts||[]).slice(0,12).map(f=>({fact_id:f.fact_id||null,summary:f.summary||''}))},
    pc:{id:publicState.pc?.id||'pc_1',name:publicState.pc?.identity?.name||null,class:publicState.pc?.identity?.class||null,health:publicState.pc?.health||null,magic:publicState.pc?.magic?{mana:publicState.pc.magic.mana,max_mana:publicState.pc.magic.max_mana,known_operations:publicState.pc.magic.known_operations||[]}:null},
    scene:{summary:publicState.scene?.summary||'',present_npcs:knownNpcs,unresolved_threads:(publicState.scene?.unresolved_threads||[]).slice(0,10)},
    active:{combat:publicState.combat||null,travel:publicState.projects?.travel||null,crafts:(publicState.projects?.crafts||[]).slice(0,8),agreements:(publicState.agreements||[]).slice(0,8)},
    resources:publicState.resources||{}, inventory:{carried_load:publicState.inventory?.carried_load??null,items:Object.values(publicState.inventory?.items||{}).slice(0,12).map(i=>({id:i.id,name:i.name,quantity:i.quantity,access:i.access}))}, recent_known_events:recentKnown,
  };
}

export function buildLocalNarration({state,publicState=null,events,resolution,playerInput,localUnderstanding=null,simulationBriefing=null,intent=null,contextPacket=null}){
  const safe=publicState||state; const mode=localUnderstanding?.interaction_mode||'world_action';
  if(mode==='meta_query') return 'Local ERGPT AI is active. It can interpret ordinary player actions, preserve short conversational context, apply self-corrections, separate hypotheses from established state, distinguish past reports and future intentions from present actions, answer bounded evidence questions, ask for clarification when a reference is unsafe to guess, and narrate committed engine results. Complex language can still be handed to ChatGPT when available.';
  if(mode==='clarification_needed'){
    const reasoning=assessLocalUnderstanding({analysis:localUnderstanding,intent,publicState:safe,contextPacket});
    const names=presentNpcNames(safe);
    if(localUnderstanding?.ambiguity_flags?.includes('missing_repeat_referent')) return 'I understand that you want to repeat something, but I cannot recover one exact previous action safely. State the action again and I will use that.';
    if(localUnderstanding?.ambiguity_flags?.includes('unparsed_intent')) return 'I do not have enough grounded language evidence to commit that as a world action safely. Rephrase the intended action or make the target explicit.';
    if(localUnderstanding?.target_resolution==='ambiguous_active_context') return `I understand that you want to continue, but more than one active process could fit. Tell me which one you mean.`;
    if(names.length>1 && ['TALK','COMBAT'].includes(localUnderstanding?.proposed_action_type)) return `I understand the intended ${String(localUnderstanding.proposed_action_type).toLowerCase()} action, but the target is ambiguous. Currently present and known to you: ${names.join(', ')}. Specify who you mean.`;
    return `I understand part of the instruction, but one reference is not grounded safely enough to act on. ${reasoning?.uncertainties?.[0]||'Please make the intended target or action explicit.'}`;
  }
  if(mode==='belief_statement'){
    const reasoning=assessLocalUnderstanding({analysis:localUnderstanding,intent,publicState:safe,contextPacket});
    const ep=reasoning?.epistemic_assessment;
    if(!ep) return 'I will treat that as a player interpretation rather than established world state.';
    const label=ep.kind==='hypothesis'?'hypothesis':ep.kind==='memory_claim'?'memory claim':ep.kind==='belief'?'belief':'assertion';
    const relevant=ep.relevant_known_information||[];
    const conflicts=ep.potential_conflicts||[];
    const evidence=relevant.length?` Player-known information that may be relevant: ${relevant.slice(0,2).map(x=>sentence(x.text)).join(' ')}`:' I do not have player-known evidence that verifies it from the current context.';
    const conflict=conflicts.length?` There is also a potential conflict with known information: ${sentence(conflicts[0].text)}`:'';
    return `I will keep “${clean(ep.claim)}” as a ${label}, not as established fact.${evidence}${conflict}`;
  }
  if(mode==='reasoning_query'){
    const reasoning=assessLocalUnderstanding({analysis:localUnderstanding,intent,publicState:safe,contextPacket});
    const causal=reasoning?.causal_assessment;
    const evidence=causal?.evidence||[];
    if(!evidence.length) return 'The player-known state does not establish a cause for that yet. I will not invent one from plausibility alone.';
    return `The known information most relevant to that question is: ${evidence.slice(0,3).map(x=>sentence(x.text)).join(' ')} That may support an explanation, but the local AI will not claim a cause unless the committed evidence actually links cause and effect.`;
  }
  if(mode==='past_report') return 'I read that as a report about the past, not a present action. It does not advance time or rewrite already committed history.';
  if(mode==='future_intent') return 'I read that as a future intention, not an action to execute now. No world action was committed.';
  if(mode==='planning_query'){
    const proposed=localUnderstanding?.proposed_action_type||'an action';
    const reasoning=assessLocalUnderstanding({analysis:localUnderstanding,intent,publicState:safe,contextPacket});
    const extra=reasoning?.uncertainties?.length?` ${reasoning.uncertainties[0]}`:'';
    return `No world action was committed. I read that as a planning question about ${String(proposed).toLowerCase()}.${extra} The deterministic engine will decide the actual result only if you commit the action.`;
  }
  if(mode==='conditional_instruction') return `No immediate world action was committed. I recognized the conditional instruction and did not execute its future action before the stated condition is resolved.`;
  if(mode==='non_action_statement') return 'No world action was committed from that statement.';
  if(mode==='world_query') return answerWorldQuery(playerInput,safe);

  const action=localUnderstanding?.action_type||resolution?.action_type||'OTHER';
  const target=localUnderstanding?.target||null; const lead=sentence(actionLead(action,target,playerInput));
  const outcome=resolution?.outcome||'resolved_without_roll';
  let result='';
  if(outcome==='infeasible') result=sentence(resolution?.reason||'The attempt is not feasible in the current state');
  else if(outcome!=='resolved_without_roll') result=`The attempt resolves as ${OUTCOME_TEXT[outcome]||String(outcome).replaceAll('_',' ')}.`;
  const summaries=uniqueSummaries(chosenEvents(events,simulationBriefing));
  const body=summaries.slice(0,8).join(' ');
  const fallback=!body ? `Committed state records the attempt: ${clean(intent?.summary||playerInput)}.` : body;
  const deferred=localUnderstanding?.deferred_action_count>0?' Any later action clause remains unexecuted unless you commit it separately.':'';
  return [lead,result,fallback].filter(Boolean).join(' ').trim()+deferred;
}

export function buildLocalAiHandoff({localUnderstanding=null,simulationBriefing=null,resolution=null,publicState=null,contextPacket=null,intent=null}){
  const reasoning=assessLocalUnderstanding({analysis:localUnderstanding,intent,publicState,contextPacket});
  return {
    authority:'derived_advisory_only', version:'ERGPT_EXT_LOCAL_AI_0.6', system_digest:buildLocalSystemDigest(publicState,contextPacket),
    language_understanding:localUnderstanding?{
      action_type:localUnderstanding.action_type, interaction_mode:localUnderstanding.interaction_mode, decision:localUnderstanding.decision,
      target:localUnderstanding.target, target_resolution:localUnderstanding.target_resolution, quoted_speech:localUnderstanding.quoted_speech,
      speech_act:localUnderstanding.speech_act, compound_action_hint:localUnderstanding.compound_action_hint,
      primary_action_index:localUnderstanding.primary_action_index,deferred_action_count:localUnderstanding.deferred_action_count,
      proposed_action_type:localUnderstanding.proposed_action_type, ambiguity_flags:localUnderstanding.ambiguity_flags||[],
      correction_applied:localUnderstanding.correction_applied||false, correction_discarded:localUnderstanding.correction_discarded||null,
      context_reference:localUnderstanding.context_reference||null, epistemic:localUnderstanding.epistemic||null,
      causal:localUnderstanding.causal||null, temporal:localUnderstanding.temporal||null,
      action_frames:(localUnderstanding.action_frames||[]).map(f=>({index:f.index,text:f.text,action_type:f.action_type,interaction_mode:f.interaction_mode,confidence_band:f.learned?.confidence_band||null})),
      learned_confidence:localUnderstanding.learned?.confidence??null, learned_margin:localUnderstanding.learned?.margin??null,
      confidence_band:localUnderstanding.learned?.confidence_band||null, alternatives:localUnderstanding.learned?.alternatives||[], model_version:localUnderstanding.learned?.model_version||null,
    }:null,
    cognitive_principles:LOCAL_COGNITIVE_PRINCIPLES,
    local_reasoning:reasoning,
    committed_resolution:resolution?{action_type:resolution.action_type,outcome:resolution.outcome,feasible:resolution.feasible!==false}:null,
    narrative_attention:simulationBriefing?{
      model_version:simulationBriefing.model?.version||null, model_status:simulationBriefing.model?.status||null,
      selected:simulationBriefing.selected_events.map(x=>({event_id:x.event.id,type:x.event.type,mandatory:x.mandatory,attention_class:x.inference?.class||'fallback',attention_score:x.inference?.attention_score??null})),
      omitted_optional_count:simulationBriefing.counts?.omitted||0,
    }:null,
  };
}
