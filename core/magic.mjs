import { clamp, sha256 } from './util.mjs';

const MAG_KEYS = ['power','scale','range','duration','complexity'];

export function defaultMagicState() {
  return {
    resource_model:'internal_mana',
    mana:12,
    max_mana:12,
    known_operations:['shape','project','sense','ward'],
    known_techniques:[],
    known_spells:[],
    sustained_effects:[],
    law_profile:{
      profile_id:'law_default_v2',
      operations:{
        shape:{base_load:1,effect_family:'control',counters:['counter','ward']},
        project:{base_load:1,effect_family:'delivery',counters:['counter','ward']},
        sense:{base_load:1,effect_family:'information',counters:['ward']},
        ward:{base_load:2,effect_family:'protection',counters:['counter']},
        counter:{base_load:2,effect_family:'counter',counters:[]},
        heal_tissue:{base_load:3,effect_family:'healing',counters:['counter']},
        translocate:{base_load:4,effect_family:'movement',counters:['ward','counter']},
      },
      resource_model:'internal_mana',
      adaptation_surcharge:2,
      improvisation_surcharge:4,
      overdraw_allowed:true,
      max_overdraw:4,
      overdraw_consequence:'fatigue_and_health_risk',
      ritual_allowed:true,
    }
  };
}

export function blueprintFromIntent(intent, playerInput='') {
  const data=intent.magic || {};
  const operations = Array.isArray(data.operations) && data.operations.length ? data.operations : [data.operation || 'shape'];
  const magnitude={};
  for (const key of MAG_KEYS) magnitude[key]=clamp(Number(data[key] ?? data.magnitude?.[key] ?? (key==='power'||key==='complexity'?1:0)),0,6);
  return {
    blueprint_id:data.blueprint_id || `spell_${sha256({text:playerInput,operations,target:intent.target||null,magnitude}).slice(0,18)}`,
    name:data.name || 'Improvised Working',
    law_profile_id:data.law_profile_id || null,
    operations,
    target:intent.target || null,
    target_tags:[...(data.target_tags||[])],
    magnitude,
    mode:data.mode || 'improvised',
    techniques:[...(data.techniques||[])],
    requirements:[...(data.requirements||[])],
    casting_time_minutes:Number(data.casting_time_minutes ?? 1),
    visible_signature:data.visible_signature || 'perceptible magical working',
    failure_tags:[...(data.failure_tags||['strain'])],
  };
}

export function spellLoad(state,bp) {
  const law=state.pc.magic.law_profile;
  let load=Object.values(bp.magnitude).reduce((a,b)=>a+Number(b||0),0);
  for (const op of bp.operations) load += Number(law.operations?.[op]?.base_load ?? 999);
  if (bp.techniques.includes('multicast') && bp.operations.length > 1) load += bp.operations.length - 1;
  return load;
}

export function safeLoad(state) {
  const intellect=Number(state.pc.attributes?.Intellect||0);
  const arcana=Number(state.pc.skills?.Arcana||0);
  const techniqueBonus=Math.min(2, Number(state.pc.magic.control_technique_bonus||0));
  return 4 + intellect + arcana + techniqueBonus;
}

export function manaCost(state,bp) {
  const law=state.pc.magic.law_profile;
  const load=spellLoad(state,bp);
  if ((law.resource_model||state.pc.magic.resource_model)==='none') return 0;
  if (bp.mode==='adapted') return load + Number(law.adaptation_surcharge ?? 2);
  if (bp.mode==='improvised') return load + Number(law.improvisation_surcharge ?? 4);
  return load; // known and generic ritual receive no free discount
}

export function formationDc(state,bp) {
  const load=spellLoad(state,bp); const safe=safeLoad(state);
  let dc=12 + 2*Math.max(0,load-safe);
  if (bp.mode==='improvised') dc=Math.max(16,dc);
  return {dc,load,safe_load:safe};
}

export function validateCast(state,bp,{authorizeOverdraw=false}={}) {
  const magic=state.pc.magic; const law=magic.law_profile;
  if (bp.law_profile_id && bp.law_profile_id!==law.profile_id) return {feasible:false,reason:'Spell blueprint belongs to a different Magic Law Profile.'};
  for (const op of bp.operations) {
    if (!law.operations?.[op]) return {feasible:false,reason:`Operation ${op} is not supported by the campaign Magic Law Profile.`};
    if (bp.mode==='improvised' && !magic.known_operations.includes(op)) return {feasible:false,reason:`Operation ${op} has not been learned well enough to improvise.`};
  }
  if (bp.mode==='improvised' && law.improvisation_allowed===false) return {feasible:false,reason:'Improvised casting is not supported by this Magic Law Profile.'};
  if (bp.mode==='ritual' && !law.ritual_allowed) return {feasible:false,reason:'Ritual casting is not supported.'};
  for (const tech of bp.techniques) if (!magic.known_techniques.includes(tech)) return {feasible:false,reason:`Technique ${tech} has not been learned.`};
  if (bp.operations.length>1 && !magic.known_techniques.includes('multicast')) return {feasible:false,reason:'Multiple simultaneous operations require the learned multicast technique.'};
  const formation=formationDc(state,bp); const cost=manaCost(state,bp); const overdraw=Math.max(0,cost-Number(magic.mana||0));
  if (overdraw>0 && (!law.overdraw_allowed || !authorizeOverdraw)) return {feasible:false,reason:'Insufficient mana; overdraw requires explicit player authorization.',...formation,cost,overdraw};
  if (overdraw>Number(law.max_overdraw||0)) return {feasible:false,reason:'Requested overdraw exceeds the Magic Law Profile hard limit.',...formation,cost,overdraw};
  const formation_uncertain = bp.mode!=='known' || formation.load>formation.safe_load || bp.requirements.includes('disrupted');
  return {feasible:true,...formation,cost,overdraw,formation_uncertain};
}

export function payCastCost(state,validation) {
  const magic=state.pc.magic;
  if ((magic.law_profile.resource_model||magic.resource_model)==='none') return {before:magic.mana,after:magic.mana,paid:0,overdraw:0};
  const before=Number(magic.mana||0); const paid=Math.min(before,validation.cost);
  magic.mana=before-paid;
  return {before,after:magic.mana,paid,overdraw:validation.overdraw||0};
}

export function formationFromOutcome(bp,outcome,effect='full') {
  const formed=['mixed','success','exceptional_success'].includes(outcome);
  return {formed,blueprint_id:bp.blueprint_id,quality:outcome,effect,application_authorized:formed,unstable:outcome==='mixed'};
}

export function counterCompatible(state,counterOperation,targetOperations=[]) {
  const law=state.pc.magic.law_profile;
  return targetOperations.some(op => (law.operations?.[op]?.counters||[]).includes(counterOperation));
}

export function applyMagicEffect(state,bp,formation,{targetNpc=null,healInjuryId=null,destination=null,sourceEventId=null}={}) {
  if (!formation.formed) return {applied:false,reason:'formation_failed'};
  if (bp.operations.includes('heal_tissue') && healInjuryId) {
    const injury=state.pc.health.injuries.find(x=>x.injury_id===healInjuryId);
    if (!injury) return {applied:false,reason:'unknown_injury'};
    if (['acute','stabilized'].includes(injury.healing_stage)) injury.healing_stage='healing';
    injury.treatment_refs ||= []; if (sourceEventId) injury.treatment_refs.push(`magic:${sourceEventId}`);
    return {applied:true,effect:'healing_stage_advanced',injury_id:healInjuryId};
  }
  if (bp.operations.includes('sense')) return {applied:true,effect:'sense_requires_existing_world_evidence'};
  if (bp.operations.includes('translocate')) {
    if (!destination) return {applied:false,reason:'destination_not_established'};
    if(!state.world.locations?.[destination])return {applied:false,reason:'destination_not_established'};
    state.pc.location_id=destination;
    return {applied:true,effect:'translocation',destination_location_id:destination};
  }
  if (targetNpc) return {applied:true,effect:'targeted_magic_formed',target_id:targetNpc.id};
  return {applied:true,effect:'world_effect_formed'};
}
