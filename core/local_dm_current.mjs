// Eternal Realms current resident Dungeon Master — grounded presentation foundation.
// Consumes ER_DM_CONTEXT_V2 only. This is a safe deterministic fallback and
// model-facing contract, NOT yet a trained generative Dungeon Master.
import {validateDmContext} from './dm_contract.mjs';
import {localDmOutput} from './local_dm_adapter.mjs';

export const CURRENT_LOCAL_DM_VERSION='ER_CURRENT_GROUNDED_DM_V1';
const clean=x=>String(x??'').trim().replace(/\s+/g,' ');
const terminate=x=>{const s=clean(x);return !s||/[.!?]$/.test(s)?s:s+'.';};
const validSummary=s=>typeof s==='string'&&s.length>0&&s.length<=4000;
const uniq=a=>[...new Set(a)];
const selectEvents=packet=>[...packet.presentation_events].sort((a,b)=>a.sequence-b.sequence||a.presentation_event_id.localeCompare(b.presentation_event_id));

export function groundedEventPlan(packet){
  validateDmContext(packet);
  const events=selectEvents(packet);
  const eventsToExpress=events.filter(e=>validSummary(clean(e.summary)));
  const missingMandatory=events.filter(e=>e.mandatory&&!validSummary(clean(e.summary)));
  if(missingMandatory.length)throw new Error('Mandatory presentation event lacks narratable player-safe summary.');
  const sentences=eventsToExpress.map(e=>terminate(e.summary));
  if(!sentences.length){
    const fallback=packet.committed_resolution?.summary||packet.immediate_scene.summary;
    if(validSummary(clean(fallback)))sentences.push(terminate(fallback));
    else throw new Error('No player-safe narration source exists.');
  }
  return Object.freeze({
    text:sentences.join(' '),
    referenced_presentation_event_ids:uniq(eventsToExpress.map(e=>e.presentation_event_id)),
    source_summaries:eventsToExpress.map(e=>clean(e.summary)),
    mandatory_ids:[...packet.required_event_ids],
  });
}
export function verifyEvidenceBoundDraft(packet,draft){
  const plan=groundedEventPlan(packet);
  if(clean(draft)!==clean(plan.text))return Object.freeze({
    accepted:false,reason:'draft_not_exactly_supported_by_player_safe_events',fallback:plan.text});
  return Object.freeze({accepted:true,reason:'player_safe_event_sequence_exact',fallback:plan.text,
    referenced_presentation_event_ids:plan.referenced_presentation_event_ids});
}
function inSceneEntities(packet){
 const ids=new Set(packet.immediate_scene.present_npc_ids);
 return packet.relevant_known_entities.filter(n=>ids.has(n.id));
}
function stateAnswer(packet){
  const t=packet.player_text.toLowerCase(),p=packet.player_status;
  if(/\b(time|hour|date|day)\b/.test(t))return 'The current recorded world time is '+p.world_time_label+'.';
  if(/\b(coin|money|currency|gold)\b/.test(t))return 'You have '+p.resources.coin+' coin.';
  if(/\b(water)\b/.test(t))return 'You have '+p.resources.water+' water.';
  if(/\b(rations|food)\b/.test(t))return 'You have '+p.resources.rations+' rations.';
  if(/\b(materials)\b/.test(t))return 'You have '+p.resources.materials+' materials.';
  if(/\b(inventory|carrying|carry|have in my bag|do i have|possess)\b/.test(t)){
    const items=p.carried_items;
    return items.length?'You are carrying '+items.map(x=>x.quantity+' '+x.name).join(', ')+'.'
      :'The player-safe inventory lists no carried items.';
  }
  if(/\b(where am i|my location)\b/.test(t))return terminate(packet.immediate_scene.summary);
  return 'That persistent detail is not available in the bounded player-safe state.';
}
function worldAnswer(packet){
 const t=packet.player_text.toLowerCase();
 if(/\b(who (is|are)|anyone (here|nearby)|who.?s here)\b/.test(t)){
   const visible=inSceneEntities(packet);
   if(visible.length)return 'You can identify '+visible.map(n=>n.name).join(', ')+'.';
   return packet.immediate_scene.present_npc_ids.length
     ?'Some people are present, but their identities are not available in this player-safe context.'
     :'The current player-safe scene identifies no other people nearby.';
 }
 if(/\b(what (can i see|do i see)|look|describe|surroundings|scene|where am i)\b/.test(t))
   return terminate(packet.immediate_scene.summary);
 return 'The available player-visible information does not establish an answer to that question.';
}
function nonAction(packet){
 switch(packet.interaction_mode){
  case 'persistent_state_query':return {kind:'state_answer',text:stateAnswer(packet)};
  case 'world_query':return {kind:'world_answer',text:worldAnswer(packet)};
  case 'planning_query':return {kind:'planning_response',text:'That is a possible plan, not an action already taken. You can choose what to attempt next.'};
  case 'belief_statement':return {kind:'belief_response',text:'That is a possibility, but the available evidence does not establish it as fact.'};
  case 'past_report':return {kind:'meta_response',text:'Your account has been recorded in this conversation, but it does not rewrite the committed campaign history.'};
  case 'future_intent':return {kind:'planning_response',text:'That remains a future plan. No action has been committed.'};
  case 'conditional_instruction':return {kind:'planning_response',text:'That is a conditional plan. It will not execute until you make an explicit, valid choice at the appropriate moment.'};
  case 'correction':return {kind:'meta_response',text:'Your correction is noted in this conversation. It does not change previously committed events.'};
  case 'repeat_reference':return {kind:'clarification',text:'Which earlier action do you want to repeat? I need a grounded, valid target before any new action.'};
  case 'continue_reference':return {kind:'clarification',text:'Which task should continue, and what would you like to attempt now?'};
  case 'clarification_needed':return {kind:'clarification',text:'Can you clarify what you would like to do or ask?'};
  case 'meta_query':return {kind:'meta_response',text:'Describe an action to attempt it, or ask a question about your character or surroundings. The game resolves actions before I describe their consequences.'};
  default:return {kind:'meta_response',text:'Understood. No action has been taken.'};
 }
}
export function invokeCurrentLocalDm(packet){
  validateDmContext(packet);
  const id=packet.recent_conversation.at(-1)?.entry_id;
  const ledgerRefs=id?[id]:[];
  if(packet.interaction_mode==='world_action'){
    if(packet.committed_resolution===null)throw new Error('Current DM cannot narrate uncommitted world actions.');
    const plan=groundedEventPlan(packet),check=verifyEvidenceBoundDraft(packet,plan.text);
    if(!check.accepted)throw new Error('Grounded narration failed its evidence check.');
    return localDmOutput({interaction_id:packet.interaction_id,
      output_kind:'narration',text:plan.text,
      presentation_event_ids:plan.referenced_presentation_event_ids,
      ledger_entry_ids:ledgerRefs});
  }
  const {kind,text}=nonAction(packet);
  return localDmOutput({interaction_id:packet.interaction_id,output_kind:kind,text,
    clarification:kind==='clarification'?text:null,ledger_entry_ids:ledgerRefs});
}
