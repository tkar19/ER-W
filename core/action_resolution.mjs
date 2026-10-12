import { clamp, sha256 } from './util.mjs';
import { rollD20 } from './rng.mjs';
import { currentLocationId } from './world_foundation.mjs';

export const ATTRIBUTES = Object.freeze(['Might','Agility','Endurance','Awareness','Intellect','Will','Presence']);
export const RISK_LEVELS = Object.freeze(['controlled','risky','dangerous','lethal']);
export const EFFECT_LEVELS = Object.freeze(['none','limited','full','amplified']);
export const OUTCOME_BANDS = Object.freeze(['severe_failure','failure','mixed','success','exceptional_success']);
export const DC = Object.freeze({ easy:8, standard:12, hard:16, formidable:20, extreme:24, legendary:28 });

export function defaultAttributes() {
  return Object.fromEntries(ATTRIBUTES.map(k => [k, 0]));
}

export function defaultSkills() {
  return {
    Athletics:0, Acrobatics:0, Stealth:0, Investigation:0, Perception:0,
    Survival:0, Medicine:0, Persuasion:0, Intimidation:0, Deception:0,
    Arcana:0, Crafting:0, Alchemy:0, Lockpicking:0, Trading:0, Leadership:0,
    Melee:0, Ranged:0, Defence:0,
  };
}

function ensureEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

export function classifyFeasibility({ feasible = true, certain = null, effect = 'full' } = {}) {
  if (!feasible || effect === 'none') return 'infeasible';
  if (certain === true) return 'certain_success';
  if (certain === false) return 'certain_failure';
  return 'uncertain';
}

export function buildResolutionPlan(state, intent, playerInput, options = {}) {
  const actor_id = options.actor_id || 'pc_1';
  const actor = actor_id === 'pc_1' ? state.pc : state.npcs?.[actor_id];
  if (!actor) throw new Error(`Unknown resolution actor ${actor_id}.`);
  const attribute = ATTRIBUTES.includes(options.attribute) ? options.attribute : null;
  const skill = options.skill && Object.hasOwn(actor.skills || {}, options.skill) ? options.skill : null;
  const situation = clamp(Number(options.situation || 0), -4, 4);
  const effect = ensureEnum(options.effect, EFFECT_LEVELS, 'full');
  const risk = ensureEnum(options.risk, RISK_LEVELS, 'risky');
  const feasibility = classifyFeasibility({ feasible: options.feasible !== false, certain: options.certain ?? null, effect });
  const dc = options.dc == null ? null : Number(options.dc);
  const target = options.target ?? intent.target ?? null;
  const method = String(options.method || intent.method || playerInput || '').trim().slice(0, 500);
  const problemState = options.problem_state ?? {
    location_id: currentLocationId(state),
    target,
    scene_id: state.scene.id,
    evidence_version: state.scene.evidence?.length || 0,
    combat_id: state.combat?.combat_id || null,
  };
  const attempt_identity = sha256({ actor_id, action_type:intent.action_type, target, method:method.toLowerCase(), problemState }).slice(0,24);
  const planCore = {
    actor_id, action_type:intent.action_type, target, method, feasibility,
    attribute, attribute_value: attribute ? Number(actor.attributes?.[attribute] || 0) : 0,
    skill, skill_value: skill ? Number(actor.skills?.[skill] || 0) : 0,
    situation, dc, risk, effect, stakes:options.stakes || [], attempt_identity,
  };
  return Object.freeze({ ...planCore, plan_digest:sha256(planCore) });
}

export function baseBand(margin) {
  if (margin >= 10) return 4;
  if (margin >= 0) return 3;
  if (margin >= -4) return 2;
  if (margin >= -9) return 1;
  return 0;
}


export function outcomeForTotal(total, dc, natural = null) {
  const margin = Number(total) - Number(dc);
  let index = baseBand(margin);
  if (natural === 20) index = Math.min(4, index + 1);
  if (natural === 1) index = Math.max(0, index - 1);
  return { outcome: OUTCOME_BANDS[index], margin };
}

export function resolvePlan(state, plan, { hiddenDc = false, allowRepeated = false } = {}) {
  if (plan.feasibility === 'infeasible') return { outcome:'infeasible', plan, check:null, feasible:false };
  if (plan.feasibility === 'certain_success') return { outcome:'success', plan, check:null, feasible:true, certain:true };
  if (plan.feasibility === 'certain_failure') return { outcome:'failure', plan, check:null, feasible:true, certain:true };
  if (!Number.isFinite(plan.dc)) throw new Error('Uncertain ResolutionPlan requires a numeric DC.');

  state.resolution ||= { attempts:{} };
  const prior = state.resolution.attempts[plan.attempt_identity];
  if (prior && !allowRepeated) {
    return {
      outcome:'repeat_blocked', feasible:false, plan, check:null,
      reason:'The same materially unchanged attempt has already been resolved. Change method, state, cost, tool, information, opposition, or position before rerolling.',
      prior,
    };
  }

  const roll = rollD20(state, `resolution:${plan.plan_digest}`);
  const total = roll.value + plan.attribute_value + plan.skill_value + plan.situation;
  const margin = total - plan.dc;
  let index = baseBand(margin);
  if (roll.value === 20) index = Math.min(4, index + 1);
  if (roll.value === 1) index = Math.max(0, index - 1);
  const outcome = OUTCOME_BANDS[index];
  const check = {
    roll_id:`roll_${roll.proof}`,
    roll:{value:roll.value,proof:roll.proof},
    natural:roll.value,
    proof:roll.proof,
    attribute:plan.attribute,
    attribute_value:plan.attribute_value,
    skill:plan.skill,
    skill_value:plan.skill_value,
    situation:plan.situation,
    total,
    dc:hiddenDc ? null : plan.dc,
    hidden_dc:hiddenDc,
    margin:hiddenDc ? null : margin,
    outcome,
    plan_digest:plan.plan_digest,
  };
  state.resolution.attempts[plan.attempt_identity] = {
    generation:state.meta.generation + 1,
    plan_digest:plan.plan_digest,
    outcome,
    problem_state_hash:sha256({location_id:currentLocationId(state), scene:state.scene.id, target:plan.target}),
  };
  return { outcome, plan, check, feasible:true };
}

export function situationFromHealth(state, tags = []) {
  let mod = 0;
  const fatigue = Number(state.pc.health?.fatigue?.level ?? state.pc.fatigue ?? 0);
  if (fatigue >= 4 && tags.includes('demanding')) return { infeasible:true, modifier:-4, reason:'collapse' };
  if (fatigue === 3 && tags.includes('demanding')) mod -= 3;
  else if (fatigue === 2 && tags.includes('demanding')) mod -= 1;
  for (const injury of state.pc.health?.injuries || []) {
    if (injury.healing_stage === 'resolved') continue;
    const relevant = (injury.functional_effects || []).some(x => tags.includes(x));
    if (!relevant) continue;
    if (injury.severity === 'critical') return { infeasible:true, modifier:-4, reason:`critical injury ${injury.injury_id}` };
    mod -= injury.severity === 'severe' ? 3 : injury.severity === 'moderate' ? 2 : 1;
  }
  return { infeasible:false, modifier:clamp(mod, -4, 4), reason:null };
}
