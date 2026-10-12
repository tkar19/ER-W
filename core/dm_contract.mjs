import { CONTRACTS, requireContract, keys, string, list, head } from './contracts.mjs';
import { validateInteraction, MODES } from './interaction_router.mjs';
import { validatePresentationEvent } from './presentation_events.mjs';
import { sha256 } from './util.mjs';

const PACKET_FIELDS=['contract_id','packet_id','campaign_id','branch_id','generation','head_hash','interaction_id','interaction_mode','player_text','recent_conversation','player_safe_state_digest','immediate_scene','player_status','relevant_known_entities','relevant_known_evidence','committed_resolution','presentation_events','required_event_ids','optional_event_ids','uncertainty','provenance','budget','packet_digest'];
const OUTPUT_FIELDS=['contract_id','interaction_id','output_kind','text','referenced_presentation_event_ids','referenced_ledger_entry_ids','clarification','npc_expression_links','provenance'];
const OUTPUT_KINDS=['narration','world_answer','state_answer','clarification','planning_response','belief_response','npc_expression','resume','meta_response'];
const CONVERSATION_STATUSES=['received','clarification_pending','corrected','cancelled','non_committing','committed_action','answered','superseded'];
const SAFE_SCENE=['id','summary','present_npc_ids','evidence','unresolved_threads'];
const SAFE_STATUS=['world_time_label','resources','carried_items'];
const SAFE_RESOURCES=['coin','rations','water','materials'];
const SAFE_ITEM=['id','name','quantity','access'];
const FORBIDDEN=new Set(['state','raw_state','internal_state','npcs','known_by','player_data','data','rng','scheduler','secrets']);
function rejectRaw(value){
  if(!value||typeof value!=='object')return;
  for(const [key,item] of Object.entries(value)){
    if(FORBIDDEN.has(key))throw new Error(`Raw/internal DM field: ${key}`);
    rejectRaw(item);
  }
}
function nullableString(value,label){if(value!==null&&typeof value!=='string')throw new Error(`Invalid ${label}.`);}
function strings(value,label){list(value,label);for(const item of value)string(item,label);}
function safeEvidence(value){
  keys(value,['evidence_id','location_id','description'],'known evidence');
  string(value.evidence_id,'evidence ID');string(value.location_id,'evidence location');string(value.description,'evidence description');
}
function safeNpc(value){
  keys(value,['id','name','gender','role','visible_condition','location','last_known_location'],'known entity');
  string(value.id,'known entity ID');string(value.name,'known entity name');
  nullableString(value.gender,'known entity gender');nullableString(value.role,'known entity role');
  if(value.location!==undefined)string(value.location,'known entity location');
  if(value.last_known_location!==undefined)string(value.last_known_location,'last known location');
  if(value.visible_condition!==null){
    keys(value.visible_condition,['life_status','injuries'],'visible condition');
    string(value.visible_condition.life_status,'visible life status');list(value.visible_condition.injuries,'visible injuries');
    for(const injury of value.visible_condition.injuries){
      keys(injury,['severity','body_location'],'visible injury');
      string(injury.severity,'visible injury severity');string(injury.body_location,'visible injury location');
    }
  }
}
function safeConversation(value){
  keys(value,['entry_id','interaction_mode','raw_text','status'],'recent conversation');
  string(value.entry_id,'conversation ID');
  if(!MODES.includes(value.interaction_mode))throw new Error('Invalid conversation mode.');
  string(value.raw_text,'conversation text');
  if(!CONVERSATION_STATUSES.includes(value.status))throw new Error('Invalid conversation status.');
}
function safeThread(value){
  keys(value,['id','label','status'],'known thread');
  string(value.id,'thread ID');string(value.label,'thread label');string(value.status,'thread status');
}
function safeNumber(value,label){if(!Number.isFinite(value)||value<0)throw new Error(`Invalid ${label}.`);}
function safePlayerStatus(value){
  keys(value,SAFE_STATUS,'player status');string(value.world_time_label,'world time label');
  keys(value.resources,SAFE_RESOURCES,'player resources');for(const key of SAFE_RESOURCES)safeNumber(value.resources[key],`player resource ${key}`);
  list(value.carried_items,'carried items');if(value.carried_items.length>32)throw new Error('Unbounded carried items.');
  for(const item of value.carried_items){keys(item,SAFE_ITEM,'carried item');string(item.id,'carried item ID');string(item.name,'carried item name');safeNumber(item.quantity,'carried item quantity');string(item.access,'carried item access');}
}
function projectEvidence(value){
  // The public state still carries discovery mechanics (methods, obscurity,
  // critical); none belongs in the DM-facing projection.
  return {evidence_id:value.evidence_id,location_id:value.location_id,description:value.description};
}
function projectNpc(value){
  return Object.fromEntries(['id','name','gender','role','visible_condition','location','last_known_location']
    .filter(k=>Object.hasOwn(value,k)).map(k=>[k,structuredClone(value[k])]));
}
export function validateDmContext(packet,currentHead){
  requireContract(packet,'dm_context');keys(packet,PACKET_FIELDS,'DM context');head(packet);
  if(currentHead&&(packet.campaign_id!==currentHead.campaign_id||packet.branch_id!==currentHead.branch_id||packet.generation!==currentHead.generation||packet.head_hash!==currentHead.head_hash))throw new Error('Stale DM context.');
  string(packet.packet_id,'packet ID');string(packet.interaction_id,'interaction ID');string(packet.player_text,'player text');
  if(!MODES.includes(packet.interaction_mode))throw new Error('Invalid DM interaction mode.');
  if(!/^[a-f0-9]{64}$/.test(packet.player_safe_state_digest)||!/^[a-f0-9]{64}$/.test(packet.packet_digest))throw new Error('Invalid DM digest.');
  keys(packet.provenance,['projection','source'],'DM provenance');
  if(packet.provenance.projection!=='pc_1'||packet.provenance.source!=='committed_head')throw new Error('DM context requires explicit player projection.');
  keys(packet.budget,['max_conversation','max_events'],'DM budget');
  if(!Number.isInteger(packet.budget.max_conversation)||packet.budget.max_conversation<0||packet.budget.max_conversation>20||!Number.isInteger(packet.budget.max_events)||packet.budget.max_events<0||packet.budget.max_events>100)throw new Error('Invalid DM budget.');
  if(packet.uncertainty!==null)throw new Error('Unsupported DM uncertainty structure.');
  if(packet.committed_resolution!==null){keys(packet.committed_resolution,['summary'],'committed resolution');if(typeof packet.committed_resolution.summary!=='string')throw new Error('Invalid resolution summary.');}
  keys(packet.immediate_scene,SAFE_SCENE,'safe scene');
  string(packet.immediate_scene.id,'scene ID');string(packet.immediate_scene.summary,'scene summary');
  strings(packet.immediate_scene.present_npc_ids,'present entity IDs');
  list(packet.immediate_scene.evidence,'scene evidence');packet.immediate_scene.evidence.forEach(safeEvidence);
  list(packet.immediate_scene.unresolved_threads,'known threads');packet.immediate_scene.unresolved_threads.forEach(safeThread);
  safePlayerStatus(packet.player_status);
  for(const n of ['recent_conversation','relevant_known_entities','relevant_known_evidence','presentation_events','required_event_ids','optional_event_ids'])list(packet[n],n);
  if(packet.recent_conversation.length>packet.budget.max_conversation||packet.presentation_events.length>packet.budget.max_events)throw new Error('Unbounded DM context.');
  packet.recent_conversation.forEach(safeConversation);packet.relevant_known_entities.forEach(safeNpc);packet.relevant_known_evidence.forEach(safeEvidence);
  if(packet.player_safe_state_digest!==sha256({scene:packet.immediate_scene,status:packet.player_status,known_entities:packet.relevant_known_entities}))throw new Error('Player-safe state digest mismatch.');
  strings(packet.required_event_ids,'required event IDs');strings(packet.optional_event_ids,'optional event IDs');
  // Check every field, including metadata and future optional containers, before
  // accepting the digest. A recomputed digest cannot authorize hidden payloads.
  rejectRaw(packet);
  const ids=new Set();for(const e of packet.presentation_events){validatePresentationEvent(e,packet);if(ids.has(e.presentation_event_id))throw new Error('Duplicate presentation event.');ids.add(e.presentation_event_id);}
  for(const id of packet.required_event_ids)if(!ids.has(id))throw new Error('Missing required presentation event.');
  for(const e of packet.presentation_events)if(e.mandatory&&!packet.required_event_ids.includes(e.presentation_event_id))throw new Error('Mandatory event omitted from required set.');
  for(const id of packet.optional_event_ids)if(!ids.has(id)||packet.required_event_ids.includes(id))throw new Error('Invalid optional event ID.');
  const {packet_digest,...core}=packet;if(packet_digest!==sha256(core))throw new Error('DM packet digest mismatch.');
  return true;
}
export function buildDmContext({interaction,head:currentHead,player_safe_state,conversation=[],presentation_events=[],committed_resolution=null}){
  validateInteraction(interaction);head(currentHead);
  if(interaction.campaign_id!==currentHead.campaign_id||interaction.branch_id!==currentHead.branch_id||interaction.generation!==currentHead.generation||interaction.head_hash!==currentHead.head_hash)throw new Error('Stale interaction.');
  // Only explicit, bounded projection fields are copied; never serialize input state wholesale.
  if(!player_safe_state?.known_npcs||!player_safe_state?.scene||!player_safe_state?.world||!player_safe_state?.resources||!player_safe_state?.inventory?.items||'npcs'in player_safe_state||'scheduler'in player_safe_state)throw new Error('Explicit player-safe projection required.');
  const scene={id:player_safe_state.scene.id,summary:player_safe_state.scene.summary,present_npc_ids:structuredClone(player_safe_state.scene.present_npc_ids),evidence:(player_safe_state.scene.evidence||[]).map(projectEvidence),unresolved_threads:structuredClone(player_safe_state.scene.unresolved_threads)};
  const carriedItems=Object.values(player_safe_state.inventory.items).sort((a,b)=>String(a.id).localeCompare(String(b.id))).slice(0,32).map(item=>({id:item.id,name:item.name,quantity:item.quantity,access:item.access}));
  const playerStatus={world_time_label:player_safe_state.world.time_label,resources:Object.fromEntries(SAFE_RESOURCES.map(key=>[key,player_safe_state.resources[key]])),carried_items:carriedItems};
  const knownEntities=player_safe_state.known_npcs.map(projectNpc);
  const core={contract_id:CONTRACTS.dm_context,packet_id:`dmp_${sha256(`${currentHead.head_hash}|${interaction.interaction_id}`).slice(0,24)}`,...currentHead,interaction_id:interaction.interaction_id,interaction_mode:interaction.interaction_mode,player_text:interaction.player_text,recent_conversation:structuredClone(conversation.slice(-20)),player_safe_state_digest:sha256({scene,status:playerStatus,known_entities:knownEntities}),immediate_scene:scene,player_status:playerStatus,relevant_known_entities:knownEntities,relevant_known_evidence:(player_safe_state.scene.evidence||[]).map(projectEvidence),committed_resolution:committed_resolution?{summary:String(committed_resolution.summary||'')}:null,presentation_events:structuredClone(presentation_events),required_event_ids:presentation_events.filter(e=>e.mandatory).map(e=>e.presentation_event_id),optional_event_ids:presentation_events.filter(e=>!e.mandatory).map(e=>e.presentation_event_id),uncertainty:null,provenance:{projection:'pc_1',source:'committed_head'},budget:{max_conversation:20,max_events:100}};
  const packet={...core,packet_digest:sha256(core)};validateDmContext(packet,currentHead);return packet;
}
export function validateDmOutput(output,packet){
  requireContract(output,'dm_output');keys(output,OUTPUT_FIELDS,'DM output');string(output.interaction_id,'interaction ID');string(output.text,'DM text');
  keys(output.provenance,['role'],'DM output provenance');
  if(!OUTPUT_KINDS.includes(output.output_kind)||output.provenance?.role!=='local'&&output.provenance?.role!=='online')throw new Error('Invalid DM output.');
  for(const k of ['referenced_presentation_event_ids','referenced_ledger_entry_ids','npc_expression_links'])strings(output[k],k);
  if(output.clarification!==null&&typeof output.clarification!=='string')throw new Error('Invalid clarification.');
  if(output.output_kind==='clarification'&&!output.clarification)throw new Error('Missing clarification.');
  rejectRaw({clarification:output.clarification,npc_expression_links:output.npc_expression_links,provenance:output.provenance});
  if(packet){
    validateDmContext(packet);
    if(output.interaction_id!==packet.interaction_id)throw new Error('DM output interaction mismatch.');
    const referenced=new Set(output.referenced_presentation_event_ids);
    if(referenced.size!==output.referenced_presentation_event_ids.length)throw new Error('Duplicate presentation event reference.');
    for(const id of referenced)if(!packet.presentation_events.some(e=>e.presentation_event_id===id))throw new Error('Unreferenced presentation event.');
    for(const id of packet.required_event_ids)if(!referenced.has(id))throw new Error('DM output omitted mandatory presentation event.');
  }
  return true;
}
export function buildOnlineHandoff(packet,currentHead){
  validateDmContext(packet,currentHead);
  return {contract_id:CONTRACTS.online_handoff,dm_context:structuredClone(packet)};
}
export function validateOnlineHandoff(handoff,currentHead){
  requireContract(handoff,'online_handoff');keys(handoff,['contract_id','dm_context'],'online handoff');validateDmContext(handoff.dm_context,currentHead);return true;
}
