import { localDmOutput } from './local_dm_adapter.mjs';
import { buildLocalNarration } from './local_ai_v09_baseline/local_narrator.mjs';
import { applyLocalVoicePolicy, DM_VOICE_POLICY, referencedVoiceEventIds } from './dm_voice.mjs';

// Integration boundary for the supplied Local AI v0.9 baseline. The bridge is
// deliberately packet-only: callers may provide ER_DM_CONTEXT_V2, never a
// canonical state object, persistence handle, or simulation callback.
export const LOCAL_AI_BASELINE=Object.freeze({
  name:'Eternal Realms Local AI',version:'0.9',authority:'presentation_only',
  voice_policy:DM_VOICE_POLICY.id,
  package:'ERGPT_Local_AI_v0.9_Review_Package',
  source_hash_manifest:'local-ai/SOURCE_HASHES.json',
  bound_components:Object.freeze({
    local_cognition:'58e5a972c0b2cdbfbc4cfe0b5d3c8c943aedadcdfa57738357840edf930c10ee',
    local_reasoner:'7b25ca0bfc065154cc885e69e756478522eb4a7fc98e73b52d2adb68fdc64ba3',
    local_narrator:'b0421ee4bc202c5e1dd4b2745be89951fabbdbe0502be0b0756c2a716e520aa1',
  }),
});

function lastLedgerId(packet){return packet.recent_conversation.at(-1)?.entry_id||null;}
function refs(packet){const id=lastLedgerId(packet);return id?[id]:[];}
function safeBaselineState(packet){
  const items=Object.fromEntries(packet.player_status.carried_items.map(item=>[item.id,structuredClone(item)]));
  return {
    meta:{branch_id:packet.branch_id,campaign_id:packet.campaign_id,generation:packet.generation},
    world:{time_label:packet.player_status.world_time_label,location:packet.immediate_scene.id,known_facts:[]},
    pc:{id:'pc_1'},
    scene:{...structuredClone(packet.immediate_scene)},
    known_npcs:structuredClone(packet.relevant_known_entities),
    projects:{travel:null,crafts:[]},combat:null,resources:structuredClone(packet.player_status.resources),inventory:{items},agreements:[],events:[],
  };
}
function baselineMode(packet){
  if(packet.interaction_mode==='persistent_state_query')return 'world_query';
  if(packet.interaction_mode==='correction')return 'non_action_statement';
  if(['continue_reference','repeat_reference'].includes(packet.interaction_mode))return 'clarification_needed';
  return packet.interaction_mode;
}
function baselineAnalysis(packet){
  const mode=baselineMode(packet);
  return {
    action_type:'OTHER',interaction_mode:mode,proposed_action_type:null,target:null,target_resolution:null,
    ambiguity_flags:mode==='clarification_needed'?['unparsed_intent']:[],correction_applied:packet.interaction_mode==='correction',
    learned:{confidence_band:'none'},
  };
}
function baselineEvents(packet){
  return [...packet.presentation_events].sort((a,b)=>a.sequence-b.sequence).map(event=>({
    id:event.presentation_event_id,type:event.normalized_type,summary:event.summary,mandatory:event.mandatory,known_by:['pc_1'],
  }));
}
function baselineText(packet){
  if(packet.interaction_mode==='persistent_state_query'&&!/(?:what do i have|what am i carrying|inventory|carry|what time is it|how much (?:coin|water)|how many (?:rations)|(?:coin|rations|food|water) do i have)/i.test(packet.player_text))return 'That persistent detail is not available in the bounded player-safe state.';
  const safe=safeBaselineState(packet),analysis=baselineAnalysis(packet);
  return buildLocalNarration({
    state:safe,publicState:safe,events:baselineEvents(packet),
    resolution:packet.committed_resolution?{action_type:'OTHER',outcome:'resolved_without_roll',summary:packet.committed_resolution.summary}:null,
    playerInput:packet.player_text,localUnderstanding:analysis,intent:null,contextPacket:{items:[]},
  });
}
function outputKind(packet){
  const kinds={world_action:'narration',world_query:'world_answer',persistent_state_query:'state_answer',planning_query:'planning_response',belief_statement:'belief_response'};
  if(['continue_reference','repeat_reference','clarification_needed'].includes(packet.interaction_mode))return 'clarification';
  return kinds[packet.interaction_mode]||'meta_response';
}

// Exact v0.9 cognition/reasoner/narrator sources are bound here behind the
// closed ER_DM_CONTEXT_V2 projection. Interaction routing remains game-owned.
export async function invokeLocalAiV09(packet){
  const common={interaction_id:packet.interaction_id,ledger_entry_ids:refs(packet)};
  const kind=outputKind(packet),text=applyLocalVoicePolicy(baselineText(packet),kind==='narration'?packet.presentation_events:[]);
  return localDmOutput({...common,output_kind:kind,text,
    presentation_event_ids:kind==='narration'?referencedVoiceEventIds(text,packet.presentation_events):[],
    clarification:kind==='clarification'?text:null,
  });
}
