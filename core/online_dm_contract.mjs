import { CONTRACTS, head, keys, list, object, requireContract, string } from './contracts.mjs';
import { validateDmOutput, validateOnlineHandoff } from './dm_contract.mjs';
import { canonicalStringify, sha256 } from './util.mjs';

export const ONLINE_DM_PHASES=Object.freeze(['interpretation','clarification','state_query','recap','post_commit_presentation']);
export const ONLINE_DM_MAX_REQUEST_BYTES=256*1024;
const CAPABILITY_FIELDS=['contract_id','supported_contracts','supported_phases','max_request_bytes'];
const REQUEST_FIELDS=['contract_id','request_id','interaction_id','request_phase','campaign_id','branch_id','generation','head_hash','packet_digest','dm_contract_id','request_attempt','player_safe_payload'];
const RESPONSE_FIELDS=['contract_id','request_id','interaction_id','request_phase','campaign_id','branch_id','generation','head_hash','packet_digest','dm_contract_id','request_attempt','dm_output'];
const REQUIRED_CONTRACTS=['online_request','online_response','online_handoff','dm_context','dm_output'];
const SENSITIVE_KEYS=new Set(['authorization','api_key','apikey','credential','credentials','provider_key','provider_token','secret','secrets','token','headers','cookie']);

function bytes(value){return new TextEncoder().encode(canonicalStringify(value)).byteLength;}
function positiveInteger(value,label){if(!Number.isInteger(value)||value<1)throw new Error(`Invalid ${label}.`);}
function phase(value){if(!ONLINE_DM_PHASES.includes(value))throw new Error('Unsupported Online DM request phase.');}
function rejectSensitive(value,path='online payload'){
  if(!value||typeof value!=='object')return;
  for(const [key,item] of Object.entries(value)){
    if(SENSITIVE_KEYS.has(key.toLowerCase()))throw new Error(`Sensitive Online DM field: ${path}.${key}`);
    rejectSensitive(item,`${path}.${key}`);
  }
}
function requestIdentity(value){return Object.fromEntries(RESPONSE_FIELDS.filter(key=>key!=='contract_id'&&key!=='dm_output').map(key=>[key,value[key]]));}

export function buildOnlineCapabilities(){
  return Object.freeze({
    contract_id:CONTRACTS.online_capabilities,
    supported_contracts:Object.freeze(REQUIRED_CONTRACTS.map(kind=>CONTRACTS[kind])),
    supported_phases:ONLINE_DM_PHASES,
    max_request_bytes:ONLINE_DM_MAX_REQUEST_BYTES,
  });
}

export function validateOnlineCapabilities(value){
  requireContract(value,'online_capabilities');keys(value,CAPABILITY_FIELDS,'Online DM capabilities');
  list(value.supported_contracts,'Online DM contracts');list(value.supported_phases,'Online DM phases');
  positiveInteger(value.max_request_bytes,'Online DM request limit');
  if(value.max_request_bytes<ONLINE_DM_MAX_REQUEST_BYTES)throw new Error('Online DM peer request limit is incompatible.');
  for(const kind of REQUIRED_CONTRACTS)if(!value.supported_contracts.includes(CONTRACTS[kind]))throw new Error(`Online DM peer lacks ${CONTRACTS[kind]}.`);
  for(const item of ONLINE_DM_PHASES)if(!value.supported_phases.includes(item))throw new Error(`Online DM peer lacks phase ${item}.`);
  for(const item of value.supported_contracts)string(item,'Online DM contract');
  for(const item of value.supported_phases)phase(item);
  rejectSensitive(value);return true;
}

export function buildOnlineDmRequest({handoff,currentHead,request_phase,request_attempt=1,request_id=null}){
  validateOnlineHandoff(handoff,currentHead);phase(request_phase);positiveInteger(request_attempt,'Online DM request attempt');
  const packet=handoff.dm_context;
  const stableId=request_id||`odr_${sha256(`${packet.interaction_id}|${packet.packet_digest}|${request_phase}`).slice(0,24)}`;
  string(stableId,'Online DM request ID');
  const request={
    contract_id:CONTRACTS.online_request,request_id:stableId,interaction_id:packet.interaction_id,request_phase,
    campaign_id:packet.campaign_id,branch_id:packet.branch_id,generation:packet.generation,head_hash:packet.head_hash,
    packet_digest:packet.packet_digest,dm_contract_id:packet.contract_id,request_attempt,
    player_safe_payload:structuredClone(handoff),
  };
  validateOnlineDmRequest(request,currentHead);return request;
}

export function validateOnlineDmRequest(request,currentHead){
  requireContract(request,'online_request');keys(request,REQUEST_FIELDS,'Online DM request');head(request);
  if(currentHead&&(request.campaign_id!==currentHead.campaign_id||request.branch_id!==currentHead.branch_id||request.generation!==currentHead.generation||request.head_hash!==currentHead.head_hash))throw new Error('Stale Online DM request.');
  string(request.request_id,'Online DM request ID');string(request.interaction_id,'Online DM interaction ID');phase(request.request_phase);
  positiveInteger(request.request_attempt,'Online DM request attempt');
  if(request.dm_contract_id!==CONTRACTS.dm_context)throw new Error('Incompatible Online DM context contract.');
  validateOnlineHandoff(request.player_safe_payload,request);
  const packet=request.player_safe_payload.dm_context;
  if(packet.interaction_id!==request.interaction_id||packet.packet_digest!==request.packet_digest||packet.contract_id!==request.dm_contract_id)throw new Error('Online DM request identity mismatch.');
  rejectSensitive(request);
  if(bytes(request)>ONLINE_DM_MAX_REQUEST_BYTES)throw new Error('Online DM request exceeds size limit.');
  return true;
}

export function buildOnlineDmResponse(request,dm_output){
  validateOnlineDmRequest(request);
  const output=structuredClone(dm_output);
  validateDmOutput(output,request.player_safe_payload.dm_context);
  if(output.provenance.role!=='online')throw new Error('Online DM response requires online provenance.');
  const response={contract_id:CONTRACTS.online_response,...requestIdentity(request),dm_output:output};
  validateOnlineDmResponse(response,request);return response;
}

export function validateOnlineDmResponse(response,request){
  requireContract(response,'online_response');keys(response,RESPONSE_FIELDS,'Online DM response');head(response);
  validateOnlineDmRequest(request);
  for(const [key,value] of Object.entries(requestIdentity(request)))if(response[key]!==value)throw new Error(`Stale or mismatched Online DM response: ${key}.`);
  object(response.dm_output,'Online DM output');validateDmOutput(response.dm_output,request.player_safe_payload.dm_context);
  if(response.dm_output.provenance.role!=='online')throw new Error('Online DM response requires online provenance.');
  rejectSensitive(response);return true;
}
