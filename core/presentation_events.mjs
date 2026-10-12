import { CONTRACTS, requireContract, keys, head, string, list } from './contracts.mjs';
import { projectEventForViewpoint } from './visibility.mjs';
import { sha256 } from './util.mjs';

// Explicit v0.6 vocabulary. Unmapped events are rejected until deliberately reviewed.
export const EVENT_TYPES=Object.freeze({
  campaign_initialized:'campaign',intent_interpreted:'internal',turn_committed:'turn',time_advanced:'time',state_schema_migrated:'internal',resolution_audit:'internal',resolution_visible:'resolution',repeat_attempt_blocked:'resolution',fatigue_changed:'health',mana_restored:'magic',
  scene_observed:'observation',investigation_resolved:'investigation',evidence_discovered:'evidence',stealth_no_observer:'stealth',observer_awareness_changed:'stealth',
  social_communication:'social',social_attempt_recorded:'social',npc_belief_pressure:'social',npc_social_decision:'social',agreement_committed:'agreement',npc_decision_checkpoint:'social',npc_routine_changed:'npc_activity',
  combat_started:'combat',npc_attack_resolved:'combat',npc_injury_added:'injury',pc_injury_added:'injury',npc_morale_pressure:'combat',npc_retreat_completed:'combat',npc_retreat_contested:'combat',combat_retreat_completed:'combat',combat_retreat_contested:'combat',combat_simultaneous_group:'combat',surrender_offered:'combat',surrender_accepted:'combat',surrender_response:'combat',
  magic_resource_spent:'magic',magic_overdraw:'magic',magic_formation_resolved:'magic',local_movement_completed:'travel',travel_completed:'travel',travel_progressed:'travel',craft_project_started:'craft',craft_work_accumulated:'craft',craft_interval_resolved:'craft',item_created:'item',
  hazard_checkpoint_mitigated:'hazard',hazard_checkpoint_applied:'hazard',hazard_resistance_resolved:'hazard',resource_demand_resolved:'resource',health_threat_resolved:'health',world_notice:'world_notice',local_situation_updated:'world_notice',scheduled_process_due:'internal',
});
const ROUTES=['dm_required','ui_required','dm_and_ui','dm_optional','silent_player_visible','hidden','human_attention'];
const FIELDS=['contract_id','presentation_event_id','source_event_id','source_event_type','normalized_type','campaign_id','branch_id','generation','head_hash','sequence','world_absolute_minute','summary','route','mandatory','attention_eligible','consequence_category','severity','visible_entity_ids','visible_location_id','state_domains_changed','sensory_basis','evidence_basis','uncertainty','interruption','novelty','causal_parent_ids','ui_targets','provenance'];
// Closed, type-owned attention metadata. These signals describe only the
// already player-perceivable event type; raw canonical data and hidden world
// importance are never consulted by presentation or attention ranking.
const ATTENTION_PROFILE=Object.freeze({
  scene_observed:Object.freeze({severity:'minor',interruption:false,domains:['scene'],sensory:['direct_observation'],evidence:[]}),
  evidence_discovered:Object.freeze({severity:'moderate',interruption:false,domains:['evidence'],sensory:['direct_observation'],evidence:['committed_discovery']}),
  combat_started:Object.freeze({severity:'major',interruption:true,domains:['combat'],sensory:['direct_observation'],evidence:[]}),
  npc_attack_resolved:Object.freeze({severity:'major',interruption:true,domains:['combat'],sensory:['direct_observation'],evidence:[]}),
  pc_injury_added:Object.freeze({severity:'critical',interruption:true,domains:['health'],sensory:['direct_experience'],evidence:[]}),
  npc_injury_added:Object.freeze({severity:'major',interruption:true,domains:['health'],sensory:['direct_observation'],evidence:[]}),
  magic_overdraw:Object.freeze({severity:'major',interruption:true,domains:['magic','health'],sensory:['direct_experience'],evidence:[]}),
  hazard_checkpoint_applied:Object.freeze({severity:'major',interruption:true,domains:['hazard','health'],sensory:['direct_experience'],evidence:[]}),
  surrender_offered:Object.freeze({severity:'moderate',interruption:true,domains:['combat','social'],sensory:['direct_observation'],evidence:[]}),
  travel_completed:Object.freeze({severity:'moderate',interruption:false,domains:['travel','location'],sensory:['direct_observation'],evidence:[]}),
  agreement_committed:Object.freeze({severity:'moderate',interruption:false,domains:['social'],sensory:['direct_observation'],evidence:[]}),
  world_notice:Object.freeze({severity:'moderate',interruption:true,domains:['world'],sensory:['direct_observation'],evidence:[]}),
});
const DEFAULT_ATTENTION_PROFILE=Object.freeze({severity:'unspecified',interruption:false,domains:[],sensory:[],evidence:[]});
function attentionProfile(type){return ATTENTION_PROFILE[type]||DEFAULT_ATTENTION_PROFILE;}
function stringArray(value,label){list(value,label);for(const item of value)string(item,label);}
function nullableString(value,label){if(value!==null)string(value,label);}
export function validatePresentationEvent(event,binding){
  requireContract(event,'presentation');keys(event,FIELDS,'presentation event');head(event);
  string(event.presentation_event_id,'presentation ID');string(event.source_event_id,'source ID');
  if(!Object.hasOwn(EVENT_TYPES,event.source_event_type)||event.normalized_type!==EVENT_TYPES[event.source_event_type])throw new Error('Unmapped presentation event.');
  if(!ROUTES.includes(event.route)||typeof event.mandatory!=='boolean'||event.mandatory&&event.route==='hidden')throw new Error('Invalid presentation route.');
  if(!Number.isInteger(event.sequence)||event.sequence<0||event.world_absolute_minute!==null&&(!Number.isFinite(event.world_absolute_minute)||event.world_absolute_minute<0))throw new Error('Invalid presentation chronology.');
  if(typeof event.summary!=='string'||typeof event.attention_eligible!=='boolean'||typeof event.interruption!=='boolean')throw new Error('Invalid presentation content.');
  string(event.consequence_category,'consequence category');string(event.severity,'severity');nullableString(event.visible_location_id,'visible location');
  // These reserved optional structures have no approved player-safe shape yet.
  if(event.uncertainty!==null||event.novelty!==null)throw new Error('Unsupported presentation metadata.');
  keys(event.provenance,['projection','authority'],'presentation provenance');
  if(event.provenance?.projection!=='pc_1'||event.provenance?.authority!=='committed_event')throw new Error('Untrusted presentation projection.');
  for(const name of ['visible_entity_ids','state_domains_changed','sensory_basis','evidence_basis','causal_parent_ids','ui_targets'])stringArray(event[name],name);
  if(binding&&(event.campaign_id!==binding.campaign_id||event.branch_id!==binding.branch_id||event.generation!==binding.generation||event.head_hash!==binding.head_hash))throw new Error('Presentation/head mismatch.');
  return true;
}
export function projectPresentationEvent(event,binding){
  head(binding);
  if(!Object.hasOwn(EVENT_TYPES,event?.type))throw new Error(`Unmapped canonical event type: ${event?.type}`);
  string(event.id,'canonical event ID');
  for(const name of ['entity_ids','causal_parent_ids'])if(event[name]!==undefined)stringArray(event[name],`canonical ${name}`);
  if(event.location_id!==undefined&&event.location_id!==null)string(event.location_id,'canonical location');
  if(event.sequence!==undefined&&(!Number.isInteger(event.sequence)||event.sequence<0))throw new Error('Invalid canonical sequence.');
  if(event.world_absolute_minute!==undefined&&event.world_absolute_minute!==null&&(!Number.isFinite(event.world_absolute_minute)||event.world_absolute_minute<0))throw new Error('Invalid canonical world minute.');
  if(event.campaign_id!=null&&event.campaign_id!==binding.campaign_id||event.branch_id!=null&&event.branch_id!==binding.branch_id||event.generation!=null&&event.generation!==binding.generation)throw new Error('Cross-head canonical event.');
  const safe=projectEventForViewpoint(event,'pc_1');if(!safe)return null;
  const normalized=EVENT_TYPES[event.type];if(normalized==='internal')return null;
  const mandatory=!['turn','time','npc_activity'].includes(normalized),profile=attentionProfile(event.type);
  const projected={contract_id:CONTRACTS.presentation,presentation_event_id:`pe_${sha256(`${binding.head_hash}|${event.id}`).slice(0,24)}`,source_event_id:event.id,source_event_type:event.type,normalized_type:normalized,...binding,sequence:safe.sequence,world_absolute_minute:safe.world_absolute_minute,summary:safe.summary,route:mandatory?'dm_and_ui':'dm_optional',mandatory,attention_eligible:!mandatory,consequence_category:normalized,severity:profile.severity,visible_entity_ids:safe.entity_ids,visible_location_id:safe.location_id,state_domains_changed:[...profile.domains],sensory_basis:[...profile.sensory],evidence_basis:[...profile.evidence],uncertainty:null,interruption:profile.interruption,novelty:null,causal_parent_ids:safe.causal_parent_ids,ui_targets:[],provenance:{projection:'pc_1',authority:'committed_event'}};
  validatePresentationEvent(projected,binding);return projected;
}

