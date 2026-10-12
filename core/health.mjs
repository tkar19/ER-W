import { clamp, sha256 } from './util.mjs';

export const FATIGUE_LABELS = Object.freeze(['fresh','taxed','fatigued','exhausted','collapse']);
export const SURVIVAL_LEVELS = Object.freeze(['normal','strained','deprived','critical']);
export const INJURY_SEVERITIES = Object.freeze(['minor','moderate','severe','critical']);
export const RECOVERY_STAGES = Object.freeze(['acute','stabilized','healing','rehabilitation','resolved','chronic']);

export function createHealthState() {
  return {
    life_status:'stable',
    injuries:[],
    fatigue:{ level:0, label:'fresh', sources:[] },
    survival:{ hydration:'normal', nutrition:'normal', sleep:'normal', thermal:'normal' },
    active_threats:[],
  };
}


export function setSurvivalPressure(state, dimension, level, source = null) {
  if (!['hydration','nutrition','sleep','thermal'].includes(dimension)) throw new Error('Invalid survival dimension.');
  if (!SURVIVAL_LEVELS.includes(level)) throw new Error('Invalid survival pressure level.');
  const before=state.pc.health.survival[dimension];
  state.pc.health.survival[dimension]=level;
  state.pc.health.survival_sources ||= [];
  if (source) state.pc.health.survival_sources.push({dimension,level,source});
  return {dimension,before,after:level};
}

export function survivalSituation(state, dimensions = []) {
  const ranks={normal:0,strained:-1,deprived:-2,critical:-4};
  let modifier=0;
  for (const d of dimensions) modifier=Math.min(modifier,ranks[state.pc.health.survival?.[d]||'normal']??0);
  return {modifier:clamp(modifier,-4,0),critical:modifier<=-4};
}

export function setFatigue(state, level, source = null) {
  const before = state.pc.health.fatigue.level;
  const next = clamp(Math.round(level), 0, 4);
  state.pc.health.fatigue.level = next;
  state.pc.health.fatigue.label = FATIGUE_LABELS[next];
  if (source) {
    const key = sha256(source).slice(0,16);
    if (!state.pc.health.fatigue.sources.some(x => x.key === key)) state.pc.health.fatigue.sources.push({key, source});
  }
  return {before, after:next, label:FATIGUE_LABELS[next]};
}

export function changeFatigue(state, delta, source) {
  return setFatigue(state, state.pc.health.fatigue.level + delta, source);
}

export function addInjury(state, injury) {
  if (!INJURY_SEVERITIES.includes(injury.severity)) throw new Error('Invalid injury severity.');
  const normalized = {
    injury_id:injury.injury_id,
    body_location:injury.body_location || 'unspecified',
    harm_type:injury.harm_type || 'physical',
    severity:injury.severity,
    source_event_id:injury.source_event_id || null,
    healing_stage:injury.healing_stage || 'acute',
    active_threats:[...(injury.active_threats || [])],
    functional_effects:[...(injury.functional_effects || [])],
    treatment_refs:[...(injury.treatment_refs || [])],
  };
  state.pc.health.injuries.push(normalized);
  recomputeLifeStatus(state);
  return normalized;
}

export function addThreat(state, threat) {
  if (!threat.process_id || !Number.isInteger(threat.due_absolute_minute)) throw new Error('Health threat needs process_id and absolute due_absolute_minute.');
  state.pc.health.active_threats.push({...threat});
  recomputeLifeStatus(state);
}

export function stabilizeThreat(state, processId, treatmentRef = null) {
  const idx = state.pc.health.active_threats.findIndex(x => x.process_id === processId);
  if (idx < 0) return false;
  const [threat] = state.pc.health.active_threats.splice(idx,1);
  if (threat.linked_injury_id) {
    const injury = state.pc.health.injuries.find(x => x.injury_id === threat.linked_injury_id);
    if (injury && injury.healing_stage === 'acute') injury.healing_stage = 'stabilized';
    if (injury && treatmentRef) injury.treatment_refs.push(treatmentRef);
  }
  recomputeLifeStatus(state);
  return true;
}

export function recomputeLifeStatus(state) {
  if (state.pc.health.life_status === 'dead') return 'dead';
  const criticalThreat = state.pc.health.active_threats.some(x => x.immediacy === 'dying');
  state.pc.health.life_status = criticalThreat ? 'dying' : state.pc.health.active_threats.length ? 'unstable' : 'stable';
  return state.pc.health.life_status;
}

export function advanceRecovery(state, injuryId, nextStage, causeRef) {
  const injury = state.pc.health.injuries.find(x => x.injury_id === injuryId);
  if (!injury) throw new Error('Unknown injury.');
  const current = RECOVERY_STAGES.indexOf(injury.healing_stage);
  const next = RECOVERY_STAGES.indexOf(nextStage);
  if (next < 0) throw new Error('Invalid recovery stage.');
  if (injury.healing_stage === 'chronic' && nextStage === 'resolved' && !String(causeRef || '').startsWith('restoration:')) {
    throw new Error('Chronic injury cannot silently resolve through ordinary recovery.');
  }
  if (next > current + 1 && !String(causeRef || '').startsWith('restoration:')) throw new Error('Ordinary recovery cannot skip stages.');
  injury.healing_stage = nextStage;
  if (causeRef) injury.treatment_refs.push(causeRef);
  return injury;
}

export function markDead(state, committedDeathEventId) {
  if (!committedDeathEventId) throw new Error('Death requires a committed death event ID.');
  state.pc.health.life_status = 'dead';
  state.pc.health.death_event_id = committedDeathEventId;
}
