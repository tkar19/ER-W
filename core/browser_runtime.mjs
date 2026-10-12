import { createInitialState, debugState, publicState, resolveTurn } from './engine.mjs';
import { reviewCreation, resolveGenesis } from './genesis.mjs';
import { localIntent } from './intent.mjs';
import { authorizeIntent, routeInteraction } from './interaction_router.mjs';
import { createConversationEntry } from './conversation_ledger.mjs';
import { createLocalDmAdapter } from './local_dm_adapter.mjs';
import { invokeLocalAiV09 } from './local_ai_v09_bridge.mjs';
import { projectPresentationEvent } from './presentation_events.mjs';
import { buildSimulationAttention } from './simulation_attention.mjs';
import { normalizeNarrationDensity } from './dm_voice.mjs';
import { projectEventsForViewpoint } from './visibility.mjs';
import { sha256 } from './util.mjs';
import {
  appendLocalConversation,
  appendLocalPresentation,
  clearLocalInteractionPhase,
  commitLocalGeneration,
  createLocalCampaign,
  diagnoseLocalHeadRecovery,
  exportLocalCampaign,
  finalizeLocalInteraction,
  importLocalCampaign,
  listLocalCampaigns,
  LOCAL_IMPORT_LIMITS,
  loadLocalHistoryIndex,
  loadLocalCurrent,
  newLocalCampaignId,
  readLocalPresentations,
  readLocalConversation,
  readLocalInteractionPhases,
  rebuildLocalHistoryIndex,
  recoverLocalPreviousHead,
  validateLocalAncestry,
  saveLocalInteractionPhase,
} from './local_store.mjs';

const defaultStore=Object.freeze({appendLocalConversation,appendLocalPresentation,clearLocalInteractionPhase,commitLocalGeneration,createLocalCampaign,diagnoseLocalHeadRecovery,exportLocalCampaign,finalizeLocalInteraction,importLocalCampaign,listLocalCampaigns,loadLocalHistoryIndex,loadLocalCurrent,newLocalCampaignId,readLocalConversation,readLocalInteractionPhases,readLocalPresentations,rebuildLocalHistoryIndex,recoverLocalPreviousHead,saveLocalInteractionPhase,validateLocalAncestry});
const defaultLocalDm=createLocalDmAdapter({invoke:invokeLocalAiV09});
const clone=value=>structuredClone(value);
export const BROWSER_IMPORT_MAX_BYTES=LOCAL_IMPORT_LIMITS.maxFileBytes;

function openingNarration(state){return `${state.pc.identity.name}'s campaign is committed at ${publicState(state).world.location} on ${state.world.time_label}. ${state.scene.summary}`;}
function localNarration(state){return state.scene.summary;}
function recapFor(state){return {text:`- ${publicState(state).scene.summary}`};}
function httpError(message,status=400,body={error:message}){return Object.assign(new Error(message),{status,body});}
function boundedUtf8Length(text,limit){let bytes=0;for(let i=0;i<text.length;i++){const code=text.charCodeAt(i);bytes+=code<0x80?1:code<0x800?2:code>=0xD800&&code<=0xDBFF&&text.charCodeAt(i+1)>=0xDC00&&text.charCodeAt(i+1)<=0xDFFF?(i++,4):3;if(bytes>limit)return bytes;}return bytes;}
function dmPath(onlineAttempted,implementation,fallbackReason=null){return {online_attempted:onlineAttempted,implementation,fallback_reason:fallbackReason};}

export function createBrowserLocalRuntime({store=defaultStore,storeOptions={},localDm=defaultLocalDm,onlineDm=null,lifecycleHook=null,narrationDensity='adaptive'}={}){
  const narrationDensityPreference=normalizeNarrationDensity(narrationDensity);
  function binding(record){return {campaign_id:record.state.meta.campaign_id,branch_id:record.state.meta.branch_id,generation:record.generation,head_hash:record.record_hash};}
  function safeConversation(entries){return entries.map(entry=>({entry_id:entry.entry_id,interaction_mode:entry.normalized_interaction_mode,raw_text:entry.raw_text,status:entry.status}));}
  async function dmResponse(args){
    let onlineResult=null;
    if(onlineDm?.respond){
      onlineResult=await onlineDm.respond(args);
      if(onlineResult?.accepted&&onlineResult.output)return onlineResult;
    }
    if(!localDm?.respond){const error=new Error('Local DM is unavailable; no canonical state was changed.');error.code='LOCAL_DM_UNAVAILABLE';throw error;}
    return {...await localDm.respond(args),accepted:true,implementation:'local',reason:onlineResult?onlineResult.reason||'online_presentation_unavailable':'local_default'};
  }
  async function view(campaignId,record=null){
    const current=record||await store.loadLocalCurrent(campaignId,storeOptions);
    const pending=store.readLocalInteractionPhases?await store.readLocalInteractionPhases(campaignId,storeOptions):[];
    for(const phase of pending.filter(item=>item.phase==='committed_awaiting_presentation')){
      if(phase.head?.head_hash!==current.record_hash)continue;
      const recent=await store.readLocalConversation(campaignId,50,storeOptions),narration=localNarration(current.state),entry=createConversationEntry(phase.interaction,{sequence:recent.length,status:'committed_action',head:phase.head,canonical_links:[current.record_hash],narration,dm_path:dmPath(phase.online_attempted,'deterministic','restart_recovery')});
      await store.finalizeLocalInteraction(campaignId,{phase,presentation:{generation:current.generation,text:narration,source:'local',kind:'turn'},conversation:entry},storeOptions);
    }
    const remaining=store.readLocalInteractionPhases?await store.readLocalInteractionPhases(campaignId,storeOptions):[];
    return {campaign_id:campaignId,generation:current.generation,state:publicState(current.state),events:projectEventsForViewpoint(current.events,'pc_1'),presentations:await store.readLocalPresentations(campaignId,50,storeOptions),conversation:await store.readLocalConversation(campaignId,50,storeOptions),interaction_recovery:remaining.map(item=>({interaction_id:item.interaction_id,phase:item.phase,generation:item.head?.generation??null})),recap:recapFor(current.state)};
  }

  async function create(creationProfile,confirmedReviewDigest){
    const genesis=resolveGenesis({creation_profile:creationProfile,confirmed_review_digest:confirmedReviewDigest});
    const campaignId=store.newLocalCampaignId(genesis.identity.name);
    const state=createInitialState(genesis,campaignId,sha256(`${campaignId}|${genesis.identity.name}|browser-local`));
    const event={id:'evt_gen0',type:'campaign_initialized',summary:'Generation 0 initialized and committed.',data:{},player_data:{},known_by:['pc_1']};
    const record=await store.createLocalCampaign(state,[event],storeOptions);
    const text=openingNarration(state);
    await store.appendLocalPresentation(campaignId,{generation:0,text,source:'local',kind:'opening'},storeOptions);
    return {...await view(campaignId,record),narration:text};
  }

  async function act(campaignId,text,expectedGeneration){
    const input=String(text||'').trim();if(!input)throw httpError('Action text is required.');
    const current=await store.loadLocalCurrent(campaignId,storeOptions);
    if(!Number.isInteger(expectedGeneration))throw httpError('expected_generation is required.');
    if(current.generation!==expectedGeneration)throw httpError('Another browser writer committed first.',409,{error:'stale_writer',current_generation:current.generation});
    const recent=await store.readLocalConversation(campaignId,50,storeOptions),head=binding(current),interaction=routeInteraction(input,head,{recent_entries:recent});
    const receivedPhase={campaign_id:campaignId,interaction_id:interaction.interaction_id,phase:'received_uncommitted',head,interaction:clone(interaction),online_attempted:Boolean(onlineDm?.respond)};
    if(store.saveLocalInteractionPhase)await store.saveLocalInteractionPhase(campaignId,receivedPhase,storeOptions);
    await lifecycleHook?.('received_uncommitted',clone(receivedPhase));
    if(interaction.interaction_mode!=='world_action')return converse(campaignId,input,expectedGeneration,{current,recent,interaction,head});
    const intent=localIntent(input,{state:publicState(current.state)}),authorised=authorizeIntent(interaction,intent),result=resolveTurn(current.state,intent,input);
    let committed;
    try{committed=await store.commitLocalGeneration(campaignId,expectedGeneration,result.state,result.events,{...storeOptions,interaction_phase:receivedPhase});}
    catch(error){if(store.clearLocalInteractionPhase)await store.clearLocalInteractionPhase(campaignId,interaction.interaction_id,storeOptions);if(error.code==='STALE_WRITER')throw httpError(error.message,409,{error:'stale_writer'});throw error;}
    const committedHead=binding(committed),presentationEvents=committed.events.map(event=>projectPresentationEvent(event,committedHead)).filter(Boolean);
    const attention=buildSimulationAttention(presentationEvents,{density:narrationDensityPreference}),selectedPresentationEvents=attention.selected_events.map(item=>item.event);
    const committedPhase={...receivedPhase,phase:'committed_awaiting_presentation',head:committedHead};
    await lifecycleHook?.('committed_awaiting_presentation',clone(committedPhase));
    let narration=localNarration(committed.state),narrationSource='local',dmFallbackReason=null,dmImplementation='deterministic';
    if(onlineDm?.respond||localDm?.respond){
      const postCommitInteraction={...authorised,...committedHead};
      try{const response=await dmResponse({interaction:postCommitInteraction,head:committedHead,player_safe_state:publicState(committed.state),conversation:safeConversation(recent),presentation_events:selectedPresentationEvents,committed_resolution:result.resolution});narration=response.output.text;dmImplementation=response.implementation==='online'?'online':'local';narrationSource=response.implementation==='online'?'online_dm':'local';if(onlineDm?.respond&&response.implementation!=='online')dmFallbackReason=response.reason||'online_presentation_unavailable';}
      catch{if(onlineDm?.respond)dmFallbackReason='online_presentation_unavailable';/* Canon is already committed; retain the player-safe deterministic scene summary. */}
    }
    const entry=createConversationEntry(authorised,{sequence:recent.length,status:'committed_action',head:committedHead,canonical_links:[committed.record_hash],narration,dm_path:dmPath(Boolean(onlineDm?.respond),dmImplementation,dmFallbackReason)});
    if(store.finalizeLocalInteraction)await store.finalizeLocalInteraction(campaignId,{phase:committedPhase,presentation:{generation:committed.generation,text:narration,source:narrationSource,kind:'turn'},conversation:entry},storeOptions);else{await store.appendLocalPresentation(campaignId,{generation:committed.generation,text:narration,source:narrationSource,kind:'turn'},storeOptions);await store.appendLocalConversation(campaignId,entry,storeOptions);}
    return {campaign_id:campaignId,generation:committed.generation,state:publicState(committed.state),events:projectEventsForViewpoint(committed.events,'pc_1'),resolution:result.resolution,intent_source:'browser_local',dm_fallback_reason:dmFallbackReason,interaction_mode:interaction.interaction_mode,committed:true,conversation_entry:entry,narration:{text:narration,source:narrationSource,kind:'turn'},recap:recapFor(committed.state)};
  }

  async function converse(campaignId,text,expectedGeneration,{current=null,recent=null,interaction=null,head=null}={}){
    const input=String(text||'').trim();if(!input)throw httpError('Interaction text is required.');
    current=current||await store.loadLocalCurrent(campaignId,storeOptions);recent=recent||await store.readLocalConversation(campaignId,50,storeOptions);head=head||binding(current);interaction=interaction||routeInteraction(input,head,{recent_entries:recent});
    if(!Number.isInteger(expectedGeneration)||current.generation!==expectedGeneration)throw httpError('Another browser writer committed first.',409,{error:'stale_writer',current_generation:current.generation});
    if(interaction.interaction_mode==='world_action')return act(campaignId,input,expectedGeneration);
    const receivedPhase={campaign_id:campaignId,interaction_id:interaction.interaction_id,phase:'received_uncommitted',head,interaction:clone(interaction),online_attempted:Boolean(onlineDm?.respond)};
    if(store.saveLocalInteractionPhase)await store.saveLocalInteractionPhase(campaignId,receivedPhase,storeOptions);
    await lifecycleHook?.('received_uncommitted',clone(receivedPhase));
    if(!onlineDm?.respond&&!localDm?.respond)throw httpError('Local DM is unavailable; no canonical state was changed.',503,{error:'local_dm_unavailable'});
    const draft=createConversationEntry(interaction,{sequence:recent.length,status:'received',head}),projected=safeConversation([...recent,draft]);
    let response;try{response=await dmResponse({interaction,head,player_safe_state:publicState(current.state),conversation:projected,presentation_events:[]});}
    catch(error){if(store.clearLocalInteractionPhase)await store.clearLocalInteractionPhase(campaignId,interaction.interaction_id,storeOptions);throw httpError(`Local DM response was rejected: ${error.message}`,503,{error:'local_dm_rejected'});}
    const after=await store.loadLocalCurrent(campaignId,storeOptions);if(after.record_hash!==current.record_hash)throw httpError('Canonical HEAD changed before the conversation could be recorded.',409,{error:'stale_writer',current_generation:after.generation});
    const status=response.output.output_kind==='clarification'?'clarification_pending':interaction.interaction_mode==='correction'?'corrected':'answered';
    const finalPhase={...receivedPhase,phase:status==='clarification_pending'?'clarification_pending':'received_uncommitted'};
    if(finalPhase.phase==='clarification_pending'&&store.saveLocalInteractionPhase)await store.saveLocalInteractionPhase(campaignId,finalPhase,storeOptions);
    if(finalPhase.phase==='clarification_pending')await lifecycleHook?.('clarification_pending',clone(finalPhase));
    const entry=createConversationEntry(interaction,{sequence:recent.length,status,head,narration:response.output.text,dm_path:dmPath(Boolean(onlineDm?.respond),response.implementation==='online'?'online':'local',onlineDm?.respond&&response.implementation!=='online'?response.reason||'online_presentation_unavailable':null)});
    const source=response.implementation==='online'?'online_dm':'local_dm';
    if(store.finalizeLocalInteraction)await store.finalizeLocalInteraction(campaignId,{phase:finalPhase,presentation:{generation:current.generation,text:response.output.text,source,kind:response.output.output_kind},conversation:entry},storeOptions);else{await store.appendLocalConversation(campaignId,entry,storeOptions);await store.appendLocalPresentation(campaignId,{generation:current.generation,text:response.output.text,source,kind:response.output.output_kind},storeOptions);}
    return {campaign_id:campaignId,generation:current.generation,state:publicState(current.state),events:[],resolution:null,intent_source:source,dm_fallback_reason:response.implementation==='online'?null:response.reason,interaction_mode:interaction.interaction_mode,committed:false,conversation_entry:entry,narration:{text:response.output.text,source,kind:response.output.output_kind},recap:recapFor(current.state)};
  }

  async function handoff(campaignId,{debug=false}={}){
    const current=await store.loadLocalCurrent(campaignId,storeOptions),visible=debug?debugState(current.state):publicState(current.state),presentations=await store.readLocalPresentations(campaignId,8,storeOptions);
    const recent=presentations.map(p=>`- G${p.generation}: ${p.text}`).join('\n');
    return {handoff:`# ERGPT External → ChatGPT handoff\n\nMode: **${debug?'DEBUG / INTERNAL — explicitly requested':'PLAYER-SAFE'}**\n\n## Current authority\n\nCampaign: ${campaignId}\nGeneration: ${current.generation}\n\n## Current ${debug?'internal ':'player-visible '}state\n\n\`\`\`json\n${JSON.stringify(visible,null,2)}\n\`\`\`\n\n## Recent presentation log\n${recent||'- No narration yet.'}\n\nTreat committed state as authoritative. Preserve PC-only player agency and state → simulation → narration ordering.`};
  }

  async function diagnose(campaignId){
    const head=await store.diagnoseLocalHeadRecovery(campaignId,storeOptions);
    if(head.status!=='head_valid')return {...head,index_status:'not_checked',recovery_action:head.recoverable?'previous_head':null};
    try{await store.loadLocalHistoryIndex(campaignId,storeOptions);return {...head,index_status:'valid',recovery_action:null};}
    catch(error){return {...head,index_status:'invalid',index_error:String(error.message||error),recoverable:true,recovery_action:'rebuild_index'};}
  }

  async function recover(campaignId,requestedAction){
    const diagnosis=await diagnose(campaignId),action=String(requestedAction||'');
    if(!diagnosis.recoverable||diagnosis.recovery_action!==action)throw httpError('Requested recovery is not currently valid.',409,{error:'recovery_state_changed'});
    if(action==='previous_head')return {...await store.recoverLocalPreviousHead(campaignId,storeOptions),recovery_action:action};
    if(action==='rebuild_index')return {recovered:true,index:await store.rebuildLocalHistoryIndex(campaignId,storeOptions),recovery_action:action};
    throw httpError('Unsupported recovery action.');
  }

  async function request(path,options={}){
    const method=String(options.method||'GET').toUpperCase(),rawBody=options.body;let body=rawBody||{};
    if(typeof rawBody==='string'){
      if(path==='/api/import'&&boundedUtf8Length(rawBody,BROWSER_IMPORT_MAX_BYTES)>BROWSER_IMPORT_MAX_BYTES)throw httpError('Save file exceeds the browser import size limit.',413,{error:'import_too_large'});
      try{body=JSON.parse(rawBody);}catch{throw httpError('Request body is not valid JSON.');}
    }
    if(method==='GET'&&path==='/api/status')return {ok:true,branch_id:'ergpt-external',openai_configured:false,authority:'browser_local',offline_capable:true};
    if(method==='GET'&&path==='/api/campaigns')return {campaigns:await store.listLocalCampaigns(storeOptions)};
    if(method==='POST'&&path==='/api/creation/review'){
      const review=reviewCreation(body);if(review.status!=='ready_for_review')throw httpError(review.clarifications?.join('; ')||'Creation requires clarification.',422,review);return review;
    }
    if(method==='POST'&&path==='/api/campaigns')return create(body.creation_profile,body.confirmed_review_digest);
    if(method==='POST'&&path==='/api/import')return {campaign_id:await store.importLocalCampaign(body,storeOptions)};
    const match=path.match(/^\/api\/campaigns\/([^/]+)(?:\/(act|export|handoff|handoff-debug|validate|debug|recovery|recover))?$/);if(!match)throw httpError('Unknown browser-local runtime route.',404);
    const campaignId=decodeURIComponent(match[1]),action=match[2]||'';
    if(method==='GET'&&!action)return view(campaignId);
    if(method==='POST'&&action==='act')return act(campaignId,body.text,Number(body.expected_generation));
    if(method==='GET'&&action==='export')return store.exportLocalCampaign(campaignId,storeOptions);
    if(method==='GET'&&action==='validate'){const ancestry=await store.validateLocalAncestry(campaignId,storeOptions),index=await store.loadLocalHistoryIndex(campaignId,storeOptions);return {...ancestry,index_head_hash:index.head_hash};}
    if(method==='GET'&&action==='recovery')return diagnose(campaignId);
    if(method==='POST'&&action==='recover')return recover(campaignId,body.recovery_action);
    if(method==='GET'&&action==='debug'){const current=await store.loadLocalCurrent(campaignId,storeOptions);return {state:clone(debugState(current.state)),latest_events:clone(current.events),context:null};}
    if(method==='GET'&&(action==='handoff'||action==='handoff-debug'))return handoff(campaignId,{debug:action==='handoff-debug'});
    throw httpError('Unsupported browser-local runtime operation.',405);
  }
  return Object.freeze({request,create,act,converse,view,diagnose,recover});
}

export const browserLocalRuntime=createBrowserLocalRuntime();
