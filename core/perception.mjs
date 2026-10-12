import { clamp, sha256 } from './util.mjs';
import { currentLocationId } from './world_foundation.mjs';

export const AWARENESS_LEVELS = Object.freeze(['unaware','alerted','located','observed']);

export function ensureObserverState(state, observerId) {
  state.perception ||= {observers:{}, search_history:{}, interpretations:{}};
  state.perception.observers[observerId] ||= {observer_id:observerId, awareness_of:{}, sensory_channels:['sight','hearing']};
  return state.perception.observers[observerId];
}

export function awareness(observerState, subjectId) {
  observerState.awareness_of[subjectId] ||= {
    current_awareness:'unaware', known_identity:false, last_known_location:null,
    interpretation:null, channels:[], source_event_ids:[], confidence:0,
  };
  return observerState.awareness_of[subjectId];
}

export function applyPerceptionCue(state,{observerId,subjectId='pc_1',level='alerted',channel='sight',identityKnown=false,location=null,sourceEventId=null,confidence=0.6}) {
  if (!AWARENESS_LEVELS.includes(level)) throw new Error('Invalid awareness level.');
  const obs=ensureObserverState(state,observerId); const a=awareness(obs,subjectId);
  const old=AWARENESS_LEVELS.indexOf(a.current_awareness); const next=AWARENESS_LEVELS.indexOf(level);
  if (next>old) a.current_awareness=level;
  if (identityKnown) a.known_identity=true;
  if (location && next>=2) a.last_known_location=location;
  if (channel && !a.channels.includes(channel)) a.channels.push(channel);
  if (sourceEventId && !a.source_event_ids.includes(sourceEventId)) a.source_event_ids.push(sourceEventId);
  a.confidence=clamp(Math.max(a.confidence||0,Number(confidence||0)),0,1);
  return a;
}

export function resolveStealthForObserver({state, observerId, subjectId='pc_1', outcome, breakObservation=false, location=null, sourceEventId=null, usableChannels=null}) {
  const obs=ensureObserverState(state,observerId); const a=awareness(obs,subjectId);
  const channels = usableChannels || obs.sensory_channels || [];
  if (a.current_awareness==='observed' && !breakObservation && channels.length && ['success','exceptional_success'].includes(outcome)) {
    return {changed:false,awareness:a,reason:'cannot_hide_in_uninterrupted_direct_observation'};
  }
  const before=a.current_awareness;
  if (outcome==='exceptional_success') a.current_awareness='unaware';
  else if (outcome==='success') a.current_awareness = a.current_awareness==='observed' ? 'alerted' : 'unaware';
  else if (outcome==='mixed') a.current_awareness = a.current_awareness==='observed' ? 'located' : 'alerted';
  else if (outcome==='failure') a.current_awareness = a.current_awareness==='unaware' ? 'alerted' : 'located';
  else if (outcome==='severe_failure') a.current_awareness='observed';
  if (a.current_awareness!=='unaware') a.last_known_location=location || currentLocationId(state);
  if (sourceEventId && !a.source_event_ids.includes(sourceEventId)) a.source_event_ids.push(sourceEventId);
  return {changed:before!==a.current_awareness,awareness:a,before};
}

export function createEvidence({id,location_id,description,fact_ids=[],methods=['search'],critical=false,obscurity=0,source_event_id=null,known_by=[],destroyed=false}) {
  if (!id || !location_id) throw new Error('Evidence requires stable id and location.');
  return {
    evidence_id:id, location_id, description, fact_ids:[...fact_ids], methods:[...methods],
    critical:Boolean(critical), obscurity:clamp(Number(obscurity),0,4), source_event_id,
    known_by:[...known_by], discovered_by:[], destroyed:Boolean(destroyed),
  };
}

export function searchEvidence(state,{actorId='pc_1',method='search',locationId=currentLocationId(state),outcome='success',attemptKey=null}) {
  state.perception ||= {observers:{},search_history:{},interpretations:{}};
  const key=attemptKey || sha256({actorId,method,locationId,evidenceVersion:state.scene.evidence.length}).slice(0,20);
  const prior=state.perception.search_history[key];
  if (prior) return {...prior,repeat:true};
  const available=(state.scene.evidence||[]).filter(e=>e.location_id===locationId && !e.destroyed && e.methods.includes(method) && !e.discovered_by?.includes(actorId));
  const discovered=[]; const missed=[];
  for (const e of available) {
    const critical=e.critical;
    const good=['mixed','success','exceptional_success'].includes(outcome);
    const exceptional=outcome==='exceptional_success';
    const canFind=critical || (good && e.obscurity <= (exceptional?4: outcome==='success'?3:1));
    if (canFind) {
      e.discovered_by ||= []; e.discovered_by.push(actorId);
      e.known_by ||= []; if (!e.known_by.includes(actorId)) e.known_by.push(actorId);
      discovered.push(e.evidence_id);
    } else missed.push(e.evidence_id);
  }
  const result={attempt_key:key,discovered,missed,critical_preserved:available.filter(e=>e.critical).every(e=>discovered.includes(e.evidence_id)),repeat:false};
  state.perception.search_history[key]=result;
  return result;
}

export function recordInterpretation(state,{interpretation_id,evidence_ids=[],proposition,status='compatible',source='engine'}) {
  state.perception ||= {observers:{},search_history:{},interpretations:{}};
  const allowed=['contradicted','unsupported','compatible','supported','strongly_supported'];
  if (!allowed.includes(status)) throw new Error('Invalid interpretation status.');
  const existing = new Set((state.scene.evidence||[]).map(e=>e.evidence_id));
  if (!evidence_ids.every(id=>existing.has(id))) throw new Error('Interpretation references unknown evidence.');
  const rec={interpretation_id,evidence_ids:[...evidence_ids],proposition,status,authority:'derived_inference',source};
  state.perception.interpretations[interpretation_id]=rec; return rec;
}
