import { validateOnlineDmRequest, validateOnlineDmResponse } from './online_dm_contract.mjs';
import { head } from './contracts.mjs';

export const ONLINE_DM_PREFERENCES=Object.freeze(['automatic','online_preferred','local_only']);
export const ONLINE_DM_AVAILABILITY=Object.freeze(['local_only','checking','online_ready','degraded','rate_limited','authentication_problem','service_unavailable','offline']);
export const ONLINE_DM_MAX_ATTEMPTS=3;
const FAILURE_KINDS=Object.freeze({
  authentication:'authentication_problem', rate_limit:'rate_limited', timeout:'service_unavailable',
  unavailable:'service_unavailable', network:'offline', contract:'degraded', cancelled:'degraded',
});

function allowed(value,values,label){if(!values.includes(value))throw new Error(`Invalid ${label}.`);return value;}
function safeFailure(kind){if(!Object.hasOwn(FAILURE_KINDS,kind))throw new Error('Invalid Online DM failure kind.');return Object.freeze({error_class:`online_${kind}`,availability:FAILURE_KINDS[kind]});}
function activeKey(request){return `${request.interaction_id}|${request.request_phase}`;}

export function createOnlineDmSession({preference='automatic',availability='local_only'}={}){
  allowed(preference,ONLINE_DM_PREFERENCES,'Online DM preference');
  allowed(availability,ONLINE_DM_AVAILABILITY,'Online DM availability');
  // Session state is deliberately non-canonical and contains no credentials,
  // campaign state, provider payloads, or conversation content.
  return {preference,availability,active:new Map()};
}

export function setOnlineDmPreference(session,preference){session.preference=allowed(preference,ONLINE_DM_PREFERENCES,'Online DM preference');return session.preference;}
export function setOnlineDmAvailability(session,availability){session.availability=allowed(availability,ONLINE_DM_AVAILABILITY,'Online DM availability');return session.availability;}
export function classifyOnlineDmFailure(kind){return safeFailure(kind);}

export function chooseDmImplementation(session){
  if(session.preference==='local_only')return Object.freeze({implementation:'local',reason:'player_local_only'});
  if(session.availability==='online_ready')return Object.freeze({implementation:'online',reason:'online_ready'});
  return Object.freeze({implementation:'local',reason:`online_${session.availability}`});
}

export function beginOnlineDmAttempt(session,request,currentHead){
  validateOnlineDmRequest(request,currentHead);
  if(request.request_attempt>ONLINE_DM_MAX_ATTEMPTS)throw new Error('Online DM retry limit exceeded.');
  const choice=chooseDmImplementation(session);
  if(choice.implementation!=='online')return Object.freeze({...choice,request_id:request.request_id});
  const key=activeKey(request),existing=session.active.get(key);
  if(existing){
    if(existing.request_id!==request.request_id||existing.packet_digest!==request.packet_digest)throw new Error('Conflicting Online DM request for active interaction.');
    if(existing.status!=='pending')return Object.freeze({implementation:'local',reason:`online_${existing.status}`,request_id:request.request_id});
    if(request.request_attempt<existing.request_attempt)throw new Error('Stale Online DM retry attempt.');
    existing.request_attempt=request.request_attempt;
    return Object.freeze({implementation:'online',reason:'retry_or_duplicate',request_id:request.request_id});
  }
  session.active.set(key,{request_id:request.request_id,packet_digest:request.packet_digest,request_attempt:request.request_attempt,status:'pending'});
  return Object.freeze({implementation:'online',reason:'started',request_id:request.request_id});
}

export function fallBackOnlineDmAttempt(session,request,kind){
  validateOnlineDmRequest(request);const failure=safeFailure(kind);const record=session.active.get(activeKey(request));
  if(!record)return Object.freeze({accepted:false,implementation:'local',reason:failure.error_class});
  if(record.request_id!==request.request_id||record.packet_digest!==request.packet_digest)throw new Error('Online DM fallback identity mismatch.');
  if(record.status==='accepted')return Object.freeze({accepted:false,implementation:'online',reason:'already_accepted'});
  record.status=kind==='cancelled'?'cancelled':'local_fallback';session.availability=failure.availability;
  return Object.freeze({accepted:false,implementation:'local',reason:failure.error_class});
}

export function acceptOnlineDmResponse(session,response,request,currentHead){
  // Revalidate the request against the live canonical HEAD at delivery time.
  // Exact request correlation alone is insufficient when canon advanced while
  // an Online DM response was in flight.
  head(currentHead);validateOnlineDmRequest(request,currentHead);validateOnlineDmResponse(response,request);const record=session.active.get(activeKey(request));
  if(!record||record.request_id!==request.request_id||record.packet_digest!==request.packet_digest)return Object.freeze({accepted:false,reason:'unknown_or_stale'});
  if(record.status!=='pending')return Object.freeze({accepted:false,reason:record.status==='accepted'?'duplicate':'late_after_local_fallback'});
  if(response.request_attempt!==record.request_attempt)return Object.freeze({accepted:false,reason:'stale_retry_attempt'});
  record.status='accepted';return Object.freeze({accepted:true,reason:'accepted',dm_output:structuredClone(response.dm_output)});
}
