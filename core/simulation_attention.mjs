import { validatePresentationEvent } from './presentation_events.mjs';
import { normalizeNarrationDensity } from './dm_voice.mjs';

export const SIMULATION_ATTENTION_CONTRACT='ER_SIMULATION_ATTENTION_V1';

const DENSITY_LIMITS=Object.freeze({concise:1,balanced:3,expansive:6});
const SEVERITY_WEIGHT=Object.freeze({unspecified:0,minor:4,moderate:12,major:24,critical:40});
const ROUTINE_TYPES=new Set(['turn','time','npc_activity']);

function bindingOf(event){
  return {campaign_id:event.campaign_id,branch_id:event.branch_id,generation:event.generation,head_hash:event.head_hash};
}

function normalizedSummary(event){
  return String(event.summary||'').trim().replace(/\s+/g,' ').toLowerCase();
}

function attentionScore(event){
  return (event.interruption?80:0)
    +(SEVERITY_WEIGHT[event.severity]??0)
    +(ROUTINE_TYPES.has(event.normalized_type)?0:16)
    +Math.min(event.state_domains_changed.length,4)*3
    +Math.min(event.visible_entity_ids.length,4)*2
    +Math.min(event.evidence_basis.length,3)*2
    +Math.min(event.sequence,999999)/1000000;
}

function resolvedDensity(requested,events){
  normalizeNarrationDensity(requested);
  if(requested!=='adaptive'){
    return requested;
  }
  if(events.some(event=>event.interruption||['major','critical'].includes(event.severity)))return 'expansive';
  if(events.some(event=>event.severity==='moderate')||events.filter(event=>event.mandatory).length>1)return 'balanced';
  return 'concise';
}

export function buildSimulationAttention(events,{density='adaptive'}={}){
  if(!Array.isArray(events))throw new TypeError('Presentation events must be an array.');
  if(events.length===0)return Object.freeze({contract_id:SIMULATION_ATTENTION_CONTRACT,density:resolvedDensity(density,events),selected_events:Object.freeze([]),counts:Object.freeze({input:0,mandatory:0,optional_selected:0,omitted:0})});

  const binding=bindingOf(events[0]);
  for(const event of events)validatePresentationEvent(event,binding);
  const resolved=resolvedDensity(density,events),mandatory=events.filter(event=>event.mandatory).sort((a,b)=>a.sequence-b.sequence);
  const seen=new Set(mandatory.map(normalizedSummary).filter(Boolean));
  const optional=events
    .filter(event=>!event.mandatory&&event.attention_eligible&&event.route==='dm_optional')
    .sort((a,b)=>attentionScore(b)-attentionScore(a)||a.sequence-b.sequence)
    .filter(event=>{
      const summary=normalizedSummary(event);
      if(!summary||seen.has(summary))return false;
      seen.add(summary);return true;
    })
    .slice(0,DENSITY_LIMITS[resolved]);
  const selected=[
    ...mandatory.map(event=>({event,mandatory:true,attention_score:null})),
    ...optional.map(event=>({event,mandatory:false,attention_score:attentionScore(event)})),
  ].sort((a,b)=>a.event.sequence-b.event.sequence);
  const eligibleOptional=events.filter(event=>!event.mandatory&&event.attention_eligible&&event.route==='dm_optional').length;
  return Object.freeze({
    contract_id:SIMULATION_ATTENTION_CONTRACT,
    density:resolved,
    selected_events:Object.freeze(selected.map(item=>Object.freeze(item))),
    counts:Object.freeze({input:events.length,mandatory:mandatory.length,optional_selected:optional.length,omitted:Math.max(0,eligibleOptional-optional.length)}),
  });
}
