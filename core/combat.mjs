import { clamp, sha256 } from './util.mjs';
import { rollD20 } from './rng.mjs';
import { addInjury } from './health.mjs';

export function ensureNpcHealth(npc) {
  npc.health ||= {life_status:'stable',injuries:[],fatigue:{level:0,label:'fresh'},protection:0};
  npc.morale ||= {state:'steady',pressure:0};
  npc.attributes ||= {Might:0,Agility:0,Endurance:0,Awareness:0,Intellect:0,Will:0,Presence:0};
  npc.skills ||= {Defence:0,Melee:0,Ranged:0};
  return npc.health;
}

function actorRecord(state, actorId) {
  if (actorId === 'pc_1') return state.pc;
  const npc=state.npcs?.[actorId];
  if (!npc) throw new Error(`Unknown combat actor ${actorId}.`);
  ensureNpcHealth(npc);
  return npc;
}

function readinessSkill(actor) {
  const skills=actor.skills||{};
  return Math.max(Number(skills.Melee||0),Number(skills.Ranged||0),Number(skills.Defence||0));
}

export function initiativeEntry(state, actorId, {situation=0, establishedScore=null}={}) {
  const actor=actorRecord(state,actorId);
  const agility=Number(actor.attributes?.Agility||0);
  const awareness=Number(actor.attributes?.Awareness||0);
  const skill=readinessSkill(actor);
  if (Number.isFinite(establishedScore)) return {actor_id:actorId,score:Number(establishedScore),agility,awareness,skill,natural:null,proof:null,established:true};
  const roll=rollD20(state,`combat_initiative:${actorId}`);
  return {actor_id:actorId,score:roll.value+awareness+skill+clamp(Number(situation||0),-4,4),agility,awareness,skill,natural:roll.value,proof:roll.proof,established:false};
}

export function groupInitiative(entries=[]) {
  const sorted=[...entries].sort((a,b)=>b.score-a.score || b.agility-a.agility || String(a.actor_id).localeCompare(String(b.actor_id)));
  const groups=[];
  for (const entry of sorted) {
    const prior=groups.at(-1);
    // Exact ties after score AND Agility remain simultaneous. Actor id is never a hidden tie-break advantage.
    if (prior && prior.score===entry.score && prior.agility===entry.agility) prior.actor_ids.push(entry.actor_id);
    else groups.push({score:entry.score,agility:entry.agility,actor_ids:[entry.actor_id]});
  }
  return groups;
}

export function startCombat(state,targetId,{pcGoal='unspecified',npcGoal='survive',establishedOrder=null}={}) {
  if (!state.npcs[targetId]) throw new Error('Combat target is not a known NPC.');
  const entries=establishedOrder
    ? establishedOrder.map((x,i)=>initiativeEntry(state,x.actor_id,{establishedScore:Number(x.score ?? (100-i))}))
    : [initiativeEntry(state,'pc_1'),initiativeEntry(state,targetId)];
  const initiative_groups=groupInitiative(entries);
  const c={
    combat_id:`combat_${sha256({campaign:state.meta.campaign_id,generation:state.meta.generation,targetId}).slice(0,18)}`,
    active:true,exchange:0,
    zones:{pc_1:'engaged',[targetId]:'engaged'},
    participants:['pc_1',targetId],
    initiative_entries:entries,
    initiative_groups,
    goal_by_actor:{pc_1:pcGoal,[targetId]:npcGoal},
    surrender_offers:[],
  };
  state.combat=c; return c;
}

export function defenceThreshold(npc,{situation=0}={}) {
  ensureNpcHealth(npc);
  return 10 + Number(npc.attributes.Agility||0) + Number(npc.skills.Defence||0) + clamp(Number(situation||0),-4,4);
}


export function pcDefenceThreshold(state,{situation=0}={}) {
  const pc=state.pc;
  return 10 + Number(pc.attributes?.Agility||0) + Number(pc.skills?.Defence||0) + clamp(Number(situation||0),-4,4);
}

export function applyPcHarm(state,{potential,penetration=0,protection=0,sourceEventId=null,nonlethal=false,bodyLocation='unspecified'}={}) {
  const rawProtection=Math.max(0,Number(protection||0));
  const effectiveProtection=Math.max(0,rawProtection-Number(penetration||0));
  const effective=clamp(Number(potential||0)-effectiveProtection,0,4);
  if(effective===0) return {injury:null,effective,protected:rawProtection>0};
  const severity=['minor','minor','moderate','severe','critical'][effective];
  const injury=addInjury(state,{
    injury_id:`inj_${sha256({pc:'pc_1',sourceEventId,effective,count:state.pc.health.injuries.length}).slice(0,18)}`,
    body_location:bodyLocation,
    harm_type:nonlethal?'blunt':'physical',
    severity,
    source_event_id:sourceEventId,
    healing_stage:'acute',
    active_threats:[],
    functional_effects:severity==='minor'?[]:['demanding'],
    treatment_refs:[],
  });
  return {injury,effective,protected:false};
}

export function initiativePosition(state,actorId) {
  const groups=state.combat?.initiative_groups||[];
  const index=groups.findIndex(g=>g.actor_ids?.includes(actorId));
  if(index<0) throw new Error(`Combat actor ${actorId} has no initiative position.`);
  return {group_index:index,simultaneous_actor_ids:[...(groups[index].actor_ids||[])]};
}

export function beginExchange(state) {
  if(!state.combat?.active) throw new Error('No active combat.');
  const number=Number(state.combat.exchange||0)+1;
  state.combat.current_exchange={number,contributions:{}};
  return state.combat.current_exchange;
}

export function recordExchangeContribution(state,actorId,contribution) {
  if(!state.combat?.active||!state.combat.current_exchange) throw new Error('No active combat exchange.');
  if(!state.combat.participants.includes(actorId)) throw new Error('Combat contribution actor is not a participant.');
  const contributions=state.combat.current_exchange.contributions;
  if(contributions[actorId]) throw new Error(`Actor ${actorId} already made a primary contribution this exchange.`);
  contributions[actorId]={actor_id:actorId,...contribution};
  return contributions[actorId];
}

export function finishExchange(state,{duration_minutes=1/6}={}) {
  if(!state.combat?.current_exchange) throw new Error('No active combat exchange to finish.');
  const exchange=state.combat.current_exchange;
  exchange.duration_minutes=Number(duration_minutes);
  state.combat.exchange=exchange.number;
  state.combat.exchange_log ||= [];
  state.combat.exchange_log.push(exchange);
  delete state.combat.current_exchange;
  return exchange;
}

export function pcActiveDefenceAuthorized(state,{explicit=false,method=null}={}) {
  if (explicit) return true;
  const doctrine=state.pc?.standing_instructions?.combat_defence;
  if (!doctrine || doctrine.enabled!==true) return false;
  if (!method) return true;
  return !Array.isArray(doctrine.allowed_methods) || doctrine.allowed_methods.length===0 || doctrine.allowed_methods.includes(method);
}

export function outnumberingSituation(extraOpponents=0) {
  return -Math.min(2,Math.max(0,Number(extraOpponents||0)));
}

export function harmPotential({weapon=null,outcome='success',effect='full',nonlethal=false}) {
  let p=Number(weapon?.harm||1);
  // Exceptional success does not automatically increase bodily harm.
  // Extra severity is available only when the pre-roll effect ceiling was independently amplified.
  if (outcome==='mixed') p-=1;
  if (effect==='limited') p-=1;
  if (effect==='amplified') p+=1;
  if (nonlethal) p=Math.min(p,2);
  return clamp(p,0,4);
}

export function applyNpcHarm(npc,{potential,penetration=0,sourceEventId=null,nonlethal=false}) {
  const health=ensureNpcHealth(npc);
  const protection=Math.max(0,Number(health.protection||0)-Number(penetration||0));
  const effective=clamp(potential-protection,0,4);
  if (effective===0) return {injury:null,effective,protected:true};
  const severity=['minor','minor','moderate','severe','critical'][effective];
  const injury={injury_id:`inj_${sha256({npc:npc.id,sourceEventId,effective,count:health.injuries.length}).slice(0,18)}`,body_location:'unspecified',harm_type:nonlethal?'blunt':'physical',severity,source_event_id:sourceEventId,healing_stage:'acute',active_threats:[],functional_effects:severity==='minor'?[]:['demanding'],treatment_refs:[]};
  health.injuries.push(injury);
  npc.morale.pressure=clamp(npc.morale.pressure + effective*2,0,10);
  npc.morale.state=npc.morale.pressure>=8?'breaking':npc.morale.pressure>=5?'shaken':'steady';
  return {injury,effective,protected:false};
}

export function npcMoraleChoice(npc,{escapeAvailable=true}={}) {
  ensureNpcHealth(npc);
  if (npc.morale.pressure>=8) return escapeAvailable?'withdrawing':'surrender-seeking';
  if (npc.morale.pressure>=5) return 'reconsider';
  return 'continue';
}

export function requestRetreat(state,actorId,{route=null,method=null,opposed=false}={}) {
  if (!state.combat?.active) return {feasible:false,reason:'No active combat.'};
  if (!state.combat.participants.includes(actorId)) return {feasible:false,reason:'Actor is not a combat participant.'};
  if (!route && !method) return {feasible:false,reason:'Retreat requires an available route or a feasible method that creates one.'};
  return {feasible:true,actor_id:actorId,route:route||null,method:method||null,opposed:Boolean(opposed),requires_resolution:Boolean(opposed)};
}

export function completeRetreat(state,actorId,{route=null}={}) {
  if (!state.combat?.active) throw new Error('No active combat.');
  state.combat.zones[actorId]=route ? `retreated:${route}` : 'retreated';
  state.combat.participants=state.combat.participants.filter(id=>id!==actorId);
  if (state.combat.participants.length<2) endCombat(state,'disengagement');
  return {actor_id:actorId,route:route||null,combat_active:Boolean(state.combat.active)};
}

export function offerSurrender(state,actorId,{terms='surrender',explicitPcChoice=false}={}) {
  if (!state.combat?.active) throw new Error('No active combat.');
  if (!state.combat.participants.includes(actorId)) throw new Error('Surrendering actor is not in combat.');
  if (actorId==='pc_1' && explicitPcChoice!==true) throw new Error('PC surrender requires an explicit player choice.');
  const offer={offer_id:`sur_${sha256({combat:state.combat.combat_id,actorId,terms,exchange:state.combat.exchange}).slice(0,18)}`,offered_by:actorId,terms:String(terms||'surrender'),status:'offered',accepted_by:null};
  state.combat.surrender_offers ||= [];
  state.combat.surrender_offers.push(offer);
  return offer;
}

export function respondToSurrender(state,offerId,responderId,response) {
  const offer=state.combat?.surrender_offers?.find(x=>x.offer_id===offerId);
  if (!offer) throw new Error('Unknown surrender offer.');
  if (!['accept','refuse','negotiate'].includes(response)) throw new Error('Invalid surrender response.');
  offer.status=response==='accept'?'accepted':response==='refuse'?'refused':'negotiating';
  if (response==='accept') {
    offer.accepted_by=responderId;
    endCombat(state,'surrender');
  }
  return offer;
}

export function endCombat(state,reason='resolved') {
  if (!state.combat) return null;
  state.combat.active=false; state.combat.ended_reason=reason; return state.combat;
}
