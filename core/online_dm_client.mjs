import { validateOnlineCapabilities, validateOnlineDmRequest, validateOnlineDmResponse } from './online_dm_contract.mjs';
import { acceptOnlineDmResponse, beginOnlineDmAttempt, fallBackOnlineDmAttempt } from './online_dm_session.mjs';

export const ONLINE_DM_CLIENT_CONTRACT='ER_ONLINE_DM_CLIENT_V1';
export const ONLINE_DM_CLIENT_MAX_TIMEOUT_MS=30000;

function httpsOrigin(value){
  let url;
  try{url=new URL(value);}catch{throw new Error('Online DM gateway URL is invalid.');}
  if(url.protocol!=='https:'||url.username||url.password)throw new Error('Online DM gateway requires HTTPS.');
  return url.origin;
}
function timeout(value){if(!Number.isInteger(value)||value<1||value>ONLINE_DM_CLIENT_MAX_TIMEOUT_MS)throw new Error('Online DM timeout is invalid.');return value;}
function exactSession(value,now){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Online DM session response is invalid.');
  const expected=['access_token','expires_at_ms','scope','token_type'];
  if(Object.keys(value).sort().join('|')!==expected.join('|'))throw new Error('Online DM session response is invalid.');
  if(typeof value.access_token!=='string'||value.access_token.length<16||value.token_type!=='Bearer'||value.scope!=='online_dm:dispatch'||!Number.isSafeInteger(value.expires_at_ms)||value.expires_at_ms<=now)throw new Error('Online DM session response is invalid.');
  return value;
}
function failureKind(error){
  if(error?.name==='AbortError'||error?.code==='client_timeout'||error?.code==='provider_timeout')return 'timeout';
  if(error?.code==='cancelled')return 'cancelled';
  if(['session_invalid','session_expired','provider_authentication'].includes(error?.code))return 'authentication';
  if(error?.code==='provider_rate_limited')return 'rate_limit';
  if(['request_invalid','provider_output_invalid','contract_incompatible'].includes(error?.code))return 'contract';
  if(error?.code==='provider_unavailable')return 'unavailable';
  return 'network';
}

export function createOnlineDmClient({transport,gateway_origin,timeout_ms=8000,now=()=>Date.now()}={}){
  if(typeof transport!=='function')throw new Error('Online DM transport must be a function.');
  if(typeof now!=='function')throw new Error('Online DM clock must be a function.');
  const origin=httpsOrigin(gateway_origin),timeoutMs=timeout(timeout_ms);
  let consent=false,credential=null,activeController=null;

  async function call(path,{method='GET',body=null,authorization=false}={}){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);activeController=controller;
    try{
      return await transport({url:`${origin}${path}`,method,signal:controller.signal,headers:{
        ...(body?{'Content-Type':'application/json'}:{}),
        ...(authorization&&credential?{Authorization:`Bearer ${credential.access_token}`}:{})
      },body:body?JSON.stringify(body):null});
    }catch(error){
      if(controller.signal.aborted&&!error?.code){const failure=new Error('Online DM request timed out.');failure.code='client_timeout';throw failure;}
      throw error;
    }finally{clearTimeout(timer);if(activeController===controller)activeController=null;}
  }

  async function connect(){
    if(!consent){const error=new Error('Online DM requires explicit consent.');error.code='consent_required';throw error;}
    if(credential&&credential.expires_at_ms>now())return true;
    const capabilities=await call('/api/online-dm/capabilities');
    try{validateOnlineCapabilities(capabilities);}catch(cause){const error=new Error('Online DM peer is incompatible.',{cause});error.code='contract_incompatible';throw error;}
    credential=structuredClone(exactSession(await call('/api/online-dm/session',{method:'POST',body:{consent:true,transport_url:origin}}),now()));
    return true;
  }

  async function exchange({session,request,currentHead}={}){
    validateOnlineDmRequest(request,currentHead);
    if(!consent)return Object.freeze({accepted:false,implementation:'local',reason:'online_consent_required'});
    const started=beginOnlineDmAttempt(session,request,currentHead);
    if(started.implementation!=='online')return started;
    try{
      await connect();
      const response=await call('/api/online-dm/dispatch',{method:'POST',authorization:true,body:{transport_url:origin,request}});
      validateOnlineDmResponse(response,request);
      return acceptOnlineDmResponse(session,response,request,currentHead);
    }catch(error){
      const result=fallBackOnlineDmAttempt(session,request,failureKind(error));
      if(['authentication','contract'].includes(failureKind(error)))credential=null;
      return Object.freeze({...result,error_class:error?.code||result.reason});
    }
  }

  async function disconnect(){
    activeController?.abort();
    if(!credential)return false;
    try{await call('/api/online-dm/revoke',{method:'POST',authorization:true,body:{transport_url:origin}});return true;}
    catch{return false;}
    finally{credential=null;}
  }

  return Object.freeze({
    contract_id:ONLINE_DM_CLIENT_CONTRACT,
    authority:'presentation_only',
    setConsent(value){consent=value===true;if(!consent){activeController?.abort();credential=null;}return consent;},
    connect,exchange,disconnect,
    cancelActive(){if(!activeController)return false;const error=new Error('Online DM request cancelled.');error.code='cancelled';activeController.abort(error);return true;},
    status:()=>Object.freeze({consent,connected:Boolean(credential&&credential.expires_at_ms>now()),gateway_origin:origin}),
  });
}
