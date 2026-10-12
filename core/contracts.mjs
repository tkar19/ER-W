// Independent, revisioned boundary identities. Unknown revisions require explicit migration.
export const CONTRACTS=Object.freeze({
  interaction:'ER_INTERACTION_V1', presentation:'ER_PLAYER_SAFE_PRESENTATION_V1',
  dm_context:'ER_DM_CONTEXT_V2', dm_output:'ER_DM_OUTPUT_V1',
  conversation:'ER_CONVERSATION_ENTRY_V1', runtime_adapter:'ER_RUNTIME_ADAPTER_V1',
  online_handoff:'ER_ONLINE_HANDOFF_V1', save_state:'ERGPT_EXT_SAVE_V2', legacy_save_state:'ERGPT_EXT_SAVE_V1',
  online_capabilities:'ER_ONLINE_CAPABILITIES_V1', online_request:'ER_ONLINE_DM_REQUEST_V1', online_response:'ER_ONLINE_DM_RESPONSE_V1',
  local_ai:'ER_LOCAL_AI_INTERFACE_V1', maintenance:'ER_MAINTENANCE_REPORT_V1',
});
export function requireContract(value,kind){
  if(value?.contract_id!==CONTRACTS[kind]) throw new Error(`Unsupported ${kind} contract revision.`);
  return true;
}
export function object(value,label){
  if(!value||typeof value!=='object'||Array.isArray(value)) throw new Error(`Invalid ${label}.`);
  return value;
}
export function keys(value,allowed,label){
  object(value,label);
  for(const key of Object.keys(value)) if(!allowed.includes(key)) throw new Error(`Unexpected ${label} field: ${key}`);
}
export function string(value,label){if(typeof value!=='string'||!value.trim())throw new Error(`Invalid ${label}.`);}
export function list(value,label){if(!Array.isArray(value))throw new Error(`Invalid ${label}.`);}
export function head(value){
  object(value,'committed head'); string(value.campaign_id,'campaign');string(value.branch_id,'branch');
  if(!Number.isInteger(value.generation)||value.generation<0||!/^[a-f0-9]{64}$/.test(value.head_hash))throw new Error('Invalid committed head.');
}
