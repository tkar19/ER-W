import { calendarMetrics } from './calendar.mjs';
import { clamp, sha256 } from './util.mjs';

export function createNpc({id,name,gender='Unspecified',role='Resident',location_id=null,capacities={},traits=[],goals=[],known_event_ids=[]}) {
  return {
    id,name,gender,role,location_id,
    stable:{ traits:[...traits], capacities:{sentience:true,sapience:true,self_awareness:true,planning_depth:2,communication_modes:['speech'],...capacities}, affiliations:[], commitments:[] },
    adaptive:{
      needs:{safety:0,duty:0,rest:0}, beliefs:[], goals:goals.map((g,i)=>({goal_id:g.goal_id||`${id}_goal_${i}`,label:g.label||String(g),status:'active',source_category:g.source_category||'role',source_ids:g.source_ids||[],priority:g.priority??1,deadline_absolute_minute:g.deadline_absolute_minute??g.deadline_minute??null,required_capacities:g.required_capacities||[]})),
      obligations:[], relationships:{}, affect:{tone:'neutral',intensity:0}, intention:null, known_event_ids:[...known_event_ids],
    },
    scheduler:{next_decision_absolute_minute:null,routines:[]},
  };
}


export function ensureNpcCognition(npc) {
  if (!npc || !npc.id) throw new Error('NPC cognition requires stable identity.');
  npc.name ||= npc.id;
  npc.gender ||= 'Unspecified';
  npc.role ||= 'Resident';
  npc.location_id ||= null;
  npc.stable ||= {traits:[],capacities:{sentience:true,sapience:true,self_awareness:true,planning_depth:2,communication_modes:['speech']},affiliations:[],commitments:[]};
  npc.stable.traits ||= [];
  npc.stable.capacities ||= {sentience:true,sapience:true,self_awareness:true,planning_depth:2,communication_modes:['speech']};
  npc.stable.affiliations ||= [];
  npc.stable.commitments ||= [];
  npc.adaptive ||= {};
  npc.adaptive.needs ||= {safety:0,duty:0,rest:0};
  npc.adaptive.beliefs ||= [];
  if (!Array.isArray(npc.adaptive.goals)) {
    const legacy=Array.isArray(npc.goals)?npc.goals:[];
    npc.adaptive.goals=legacy.map((g,i)=>({goal_id:`${npc.id}_goal_${i}`,label:typeof g==='string'?g:(g.label||String(g)),status:'active',source_category:'legacy',source_ids:[],priority:1,deadline_absolute_minute:null,required_capacities:[]}));
  }
  npc.adaptive.obligations ||= [];
  npc.adaptive.relationships ||= {};
  npc.adaptive.affect ||= {tone:'neutral',intensity:0};
  npc.adaptive.intention ??= null;
  npc.adaptive.known_event_ids ||= [];
  npc.scheduler ||= {next_decision_absolute_minute:null,routines:[]};
  npc.scheduler.routines ||= [];
  if (npc.scheduler.next_decision_absolute_minute == null && npc.scheduler.next_decision_minute != null) npc.scheduler.next_decision_absolute_minute=npc.scheduler.next_decision_minute;
  return npc;
}

export function relationship(npc, otherId) {
  ensureNpcCognition(npc);
  npc.adaptive.relationships[otherId] ||= {trust:0,respect:0,affection:0,fear:0,obligation:0,provenance:[]};
  return npc.adaptive.relationships[otherId];
}

export function changeRelationship(npc, otherId, changes, sourceEventId) {
  const r=relationship(npc,otherId);
  for (const k of ['trust','respect','affection','fear','obligation']) if (changes[k] != null) r[k]=clamp(r[k]+Number(changes[k]),-100,100);
  if (sourceEventId) r.provenance.push(sourceEventId);
  return r;
}

export function addBelief(npc, belief, knownEventIds = npc.adaptive.known_event_ids) {
  const sources=[...(belief.source_event_ids||[])];
  if (!sources.every(id=>knownEventIds.includes(id))) throw new Error('Belief provenance must be known to the NPC.');
  if (npc.adaptive.beliefs.some(x=>x.belief_id===belief.belief_id)) throw new Error('Duplicate belief ID.');
  const record={belief_id:belief.belief_id, proposition:belief.proposition, stance:belief.stance||'uncertain',confidence:clamp(Number(belief.confidence??0.5),0,1),source_event_ids:sources,last_update_generation:belief.last_update_generation??0};
  npc.adaptive.beliefs.push(record); return record;
}

function hasCap(npc, cap) { return npc.stable.capacities?.[cap] === true || (Array.isArray(npc.stable.capacities?.tags) && npc.stable.capacities.tags.includes(cap)); }

export function proposeNpcDecision(npc, state, options = []) {
  ensureNpcCognition(npc);
  if (npc.id === 'pc_1') throw new Error('Cognition cannot autonomously choose a voluntary PC action.');
  const eligible=options.filter(o => {
    if (o.available === false) return false;
    if ((o.required_capacities||[]).some(c=>!hasCap(npc,c))) return false;
    if ((o.required_known_event_ids||[]).some(id=>!npc.adaptive.known_event_ids.includes(id))) return false;
    if (o.goal_id && !npc.adaptive.goals.some(g=>g.goal_id===o.goal_id && g.status==='active')) return false;
    return true;
  });
  const now=state.world.absolute_minute;
  const scored=eligible.map(o=>{
    const goal=npc.adaptive.goals.find(g=>g.goal_id===o.goal_id);
    const rel=o.target_id ? relationship(npc,o.target_id) : null;
    let utility=Number(o.base||0)+Number(o.need_fit||0)+Number(o.obligation||0)+Number(o.opportunity||0)-Number(o.risk||0)-Number(o.cost||0);
    utility += Number(goal?.priority||0)*2;
    if (goal?.deadline_absolute_minute != null) utility += Math.max(0, 4 - Math.floor((goal.deadline_absolute_minute-now)/calendarMetrics(state.world.calendar).minutes_per_hour));
    if (rel) utility += (rel.trust+rel.respect+rel.affection+rel.obligation-rel.fear)/100;
    if (npc.adaptive.intention?.option_id === o.option_id) utility += 1.25;
    return {o,utility};
  }).sort((a,b)=>b.utility-a.utility || String(a.o.option_id).localeCompare(String(b.o.option_id)));
  const chosen=scored[0];
  if (!chosen) return {proposal_id:`proposal_${sha256({npc:npc.id,gen:state.meta.generation,none:true}).slice(0,18)}`,npc_id:npc.id,option_id:null,action:null,utility:null,authoritative:false,next_review_absolute_minute:now+calendarMetrics(state.world.calendar).minutes_per_hour};
  return {
    proposal_id:`proposal_${sha256({npc:npc.id,gen:state.meta.generation,option:chosen.o.option_id,utility:chosen.utility}).slice(0,18)}`,
    npc_id:npc.id, option_id:chosen.o.option_id, action:chosen.o.action, target_id:chosen.o.target_id||null,
    utility:Number(chosen.utility.toFixed(3)), rationale_refs:[...(chosen.o.rationale_refs||[])], authoritative:false,
    next_review_absolute_minute:now + Math.max(1,Number(chosen.o.plan_duration_minutes||30)),
  };
}

export function socialResponseOptions(npc, request, pressure=0) {
  ensureNpcCognition(npc);
  const rel=relationship(npc,'pc_1');
  const duty=(npc.adaptive.needs.duty||0);
  return [
    {option_id:'agree',action:'agree',target_id:'pc_1',base:pressure/2 + rel.trust/30 + rel.affection/40 + rel.obligation/25, risk:request.conflict_with_goal?4:0, plan_duration_minutes:5},
    {option_id:'negotiate',action:'negotiate',target_id:'pc_1',base:2 + rel.respect/50 + Math.abs(pressure)/10, plan_duration_minutes:5},
    {option_id:'delay',action:'delay',target_id:'pc_1',base:1 + duty/2 + (request.urgency? -1:1), plan_duration_minutes:15},
    {option_id:'refuse',action:'refuse',target_id:'pc_1',base:request.conflict_with_goal?7:1 + rel.fear/60 - rel.trust/60, plan_duration_minutes:10},
  ];
}
