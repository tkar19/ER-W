import { CONTRACTS, requireContract, head, string, list } from './contracts.mjs';
import { validateInteraction } from './interaction_router.mjs';
import { sha256 } from './util.mjs';

const LEGACY_FIELDS=['contract_id','entry_id','campaign_id','branch_id','sequence','world_generation','head_hash','interaction_id','speaker','raw_text','normalized_interaction_mode','interpreted_action','status','references','proposition','canonical_links','presentation_links','narration','created_order','provenance'];
const FIELDS=[...LEGACY_FIELDS,'dm_path'];
const DM_PATH_FIELDS=['online_attempted','implementation','fallback_reason'];
const STATUSES=['received','clarification_pending','corrected','cancelled','non_committing','committed_action','answered','superseded'];
const DM_IMPLEMENTATIONS=['online','local','deterministic'];
function exactFields(value,expected){return Object.keys(value).sort().join('|')===[...expected].sort().join('|');}
export function validateConversationDmPath(value){
  if(value===null)return true;
  if(!value||typeof value!=='object'||Array.isArray(value)||!exactFields(value,DM_PATH_FIELDS))throw new Error('Invalid conversation DM path.');
  if(typeof value.online_attempted!=='boolean'||!DM_IMPLEMENTATIONS.includes(value.implementation))throw new Error('Invalid conversation DM path.');
  if(value.implementation==='online'&&(!value.online_attempted||value.fallback_reason!==null))throw new Error('Invalid Online DM path.');
  if(value.online_attempted&&value.implementation!=='online'&&value.fallback_reason===null)throw new Error('Online fallback DM path requires a safe reason.');
  if(value.fallback_reason!==null&&(typeof value.fallback_reason!=='string'||!/^[-a-z0-9_]{1,80}$/.test(value.fallback_reason)))throw new Error('Invalid conversation DM fallback reason.');
  if(!value.online_attempted&&value.fallback_reason!==null)throw new Error('Local-only DM path cannot claim Online fallback.');
  return true;
}
export function validateConversationEntry(entry){
  requireContract(entry,'conversation');
  if(!exactFields(entry,FIELDS)&&!exactFields(entry,LEGACY_FIELDS))throw new Error('Unexpected conversation entry fields.');
  head({campaign_id:entry.campaign_id,branch_id:entry.branch_id,generation:entry.world_generation,head_hash:entry.head_hash});
  string(entry.entry_id,'entry ID');string(entry.interaction_id,'interaction ID');string(entry.raw_text,'ledger text');
  if(entry.speaker!=='player'||!STATUSES.includes(entry.status)||!Number.isInteger(entry.sequence)||entry.sequence<0||entry.created_order!==entry.sequence)throw new Error('Invalid ledger sequence/status.');
  list(entry.references,'references');list(entry.canonical_links,'canonical links');list(entry.presentation_links,'presentation links');
  if(entry.status!=='committed_action'&&entry.canonical_links.length)throw new Error('Noncommitting ledger entry cannot claim canon.');
  if(entry.provenance?.authority!=='conversation_only')throw new Error('Ledger cannot own canon.');
  if(Object.hasOwn(entry,'dm_path'))validateConversationDmPath(entry.dm_path);
  return true;
}
export function createConversationEntry(interaction,{sequence,status,head:currentHead,canonical_links=[],presentation_links=[],narration=null,dm_path=null}={}){
  validateInteraction(interaction);head(currentHead);
  const entry={contract_id:CONTRACTS.conversation,entry_id:`ce_${sha256(`${interaction.interaction_id}|${sequence}`).slice(0,24)}`,campaign_id:currentHead.campaign_id,branch_id:currentHead.branch_id,sequence,world_generation:currentHead.generation,head_hash:currentHead.head_hash,interaction_id:interaction.interaction_id,speaker:'player',raw_text:interaction.player_text,normalized_interaction_mode:interaction.interaction_mode,interpreted_action:interaction.commit_authorised?structuredClone(interaction.proposed_intent):null,status,references:[...interaction.ledger_links],proposition:['belief_statement','past_report','future_intent'].includes(interaction.interaction_mode)?interaction.player_text:null,canonical_links,presentation_links,narration,created_order:sequence,provenance:{authority:'conversation_only',source:'player_input'},dm_path:dm_path===null?null:structuredClone(dm_path)};
  validateConversationEntry(entry);return entry;
}
export function validateConversationLedger(entries){
  list(entries,'ledger');let prev=null;const ids=new Set();
  for(const entry of entries){validateConversationEntry(entry);if(entry.sequence!==(prev?.sequence??-1)+1||prev&&(entry.campaign_id!==prev.campaign_id||entry.branch_id!==prev.branch_id||entry.world_generation<prev.world_generation))throw new Error('Invalid ledger order/identity.');if(ids.has(entry.entry_id))throw new Error('Duplicate ledger ID.');ids.add(entry.entry_id);prev=entry;}
  return true;
}

