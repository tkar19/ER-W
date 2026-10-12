import { clamp, deepClone } from './util.mjs';
import { defaultSkills } from './action_resolution.mjs';
import { createHealthState } from './health.mjs';
import { defaultMagicState } from './magic.mjs';
import { createSchedulerState, scheduleProcess } from './scheduler.mjs';
import { cloneDefaultCalendar, DEFAULT_WORLD_START, dateToAbsoluteMinute, refreshTimeViews, isRoutineActiveAt, nextRoutineBoundary, minuteOfWorldDay } from './calendar.mjs';
import { CORE } from './core_constants.mjs';
import { migratePersistentLocations, SUPPORTED_STATE_SCHEMAS } from './world_foundation.mjs';

export function migrateState(input) {
  const state=deepClone(input);
  const originalSchema=Number(state.meta?.schema_version||1);
  if(originalSchema!==SUPPORTED_STATE_SCHEMAS.current&&!SUPPORTED_STATE_SCHEMAS.migratable.includes(originalSchema))throw new Error(`Unsupported state schema version: ${originalSchema}`);
  let migrated=false;

  if (originalSchema < 2) {
    const old=state.pc?.attributes||{};
    const baseline = v => clamp(Number(v??10)-10,-4,6);
    state.pc.attributes={
      Might:baseline(old.Strength), Agility:baseline(old.Dexterity), Endurance:baseline(old.Constitution),
      Awareness:baseline(old.Wisdom), Intellect:baseline(old.Intelligence), Will:0, Presence:baseline(old.Charisma),
    };
    const skills=defaultSkills();
    for (const [k,v] of Object.entries(state.pc.skills||{})) if (Object.hasOwn(skills,k)) skills[k]=Number(v||0);
    if (state.pc.skills?.Combat!=null) { skills.Melee=Number(state.pc.skills.Combat||0); skills.Ranged=Number(state.pc.skills.Combat||0); }
    state.pc.skills=skills;
    const oldFatigue=Number(state.pc.fatigue||0);
    const h=createHealthState(); h.life_status=state.pc.health?.life_status==='dead'?'dead':'stable';
    h.fatigue.level=clamp(Math.floor(oldFatigue/25),0,4); h.fatigue.label=['fresh','taxed','fatigued','exhausted','collapse'][h.fatigue.level];
    h.injuries=(state.pc.health?.injuries||[]).map((x,i)=>({injury_id:x.injury_id||x.id||`legacy_injury_${i}`,body_location:x.body_location||'unspecified',harm_type:x.harm_type||'physical',severity:x.severity||'minor',source_event_id:x.source_event_id||null,healing_stage:x.healing_stage||'acute',active_threats:[...(x.active_threats||[])],functional_effects:[...(x.functional_effects||[])],treatment_refs:[...(x.treatment_refs||[])]}));
    state.pc.health=h; delete state.pc.fatigue;
    const m=defaultMagicState(); Object.assign(m,{mana:Number(state.pc.magic?.mana??m.mana),max_mana:Number(state.pc.magic?.max_mana??m.max_mana),known_techniques:[...(state.pc.magic?.known_techniques||[])]}); state.pc.magic=m;
    state.pc.carry_capacity=Number(state.pc.carry_capacity||12);
    for (const item of Object.values(state.inventory?.items||{})) { item.load=Number(item.load??item.mass??0); delete item.mass; item.access ||= 'stowed'; item.condition ||= 'sound'; item.defects ||= []; item.tags ||= []; }
    state.scheduler=createSchedulerState(); state.scheduler.fictional_minute=Number(state.world?.epoch_minute||0);
    state.projects ||= {travel:null,crafts:{},repairs:{}}; state.projects.travel ||= null; state.projects.crafts ||= {}; state.projects.repairs ||= {};
    state.environment ||= {exposures:[]}; state.perception ||= {observers:{},search_history:{},interpretations:{}}; state.resolution ||= {attempts:{}}; state.combat ||= null;
    state.scene.id ||= 'scene_active'; state.scene.evidence ||= []; state.scene.unresolved_threads ||= [];
    state.world.known_facts ||= []; state.world.hazards ||= [];
    state.meta.schema_version=2;
    migrated=true;
  }

  if ((state.meta?.schema_version||2) < 3) {
    const elapsed=Number(state.world?.epoch_minute ?? state.scheduler?.fictional_minute ?? 0);
    const calendar=cloneDefaultCalendar();
    const startAbsolute=dateToAbsoluteMinute(DEFAULT_WORLD_START,calendar);
    state.world ||= {};
    state.world.calendar=calendar;
    state.world.absolute_minute=Number((startAbsolute+elapsed).toFixed(6));
    delete state.world.epoch_minute;
    state.campaign_clock={start_absolute_minute:startAbsolute,elapsed_minute:elapsed};

    state.scheduler ||= createSchedulerState();
    state.scheduler.absolute_minute=state.world.absolute_minute;
    delete state.scheduler.fictional_minute;
    for (const proc of state.scheduler.pending||[]) {
      if (proc.due_absolute_minute==null) proc.due_absolute_minute=startAbsolute+Number(proc.due_minute??elapsed);
      delete proc.due_minute;
    }

    for (const npc of Object.values(state.npcs||{})) {
      npc.scheduler ||= {};
      npc.scheduler.routines ||= [];
      if (npc.scheduler.next_decision_absolute_minute==null && npc.scheduler.next_decision_minute!=null) npc.scheduler.next_decision_absolute_minute=startAbsolute+Number(npc.scheduler.next_decision_minute);
      delete npc.scheduler.next_decision_minute;
      for (const goal of npc.adaptive?.goals||[]) {
        if (goal.deadline_absolute_minute==null && goal.deadline_minute!=null) goal.deadline_absolute_minute=startAbsolute+Number(goal.deadline_minute);
        delete goal.deadline_minute;
      }
      if (npc.id==='npc_arrival_clerk' && npc.scheduler.routines.length===0) {
        const routine={routine_id:'arrival_desk_shift',label:'Arrival desk shift',weekday_indices:[0,1,2,3,4,5,6],start_minute_of_day:minuteOfWorldDay(8,0,calendar),end_minute_of_day:minuteOfWorldDay(17,0,calendar),active_location:'Arrival Point',inactive_location:'Off Duty',activity:'staff_arrival_desk'};
        npc.scheduler.routines.push(routine);
        const active=isRoutineActiveAt(state.world.absolute_minute,calendar,routine);
        npc.location=active?routine.active_location:routine.inactive_location;
        state.scene.present_npc_ids ||= [];
        state.scene.present_npc_ids=state.scene.present_npc_ids.filter(id=>id!==npc.id);
        if(active && npc.location===state.world.location) state.scene.present_npc_ids.push(npc.id);
        const next=nextRoutineBoundary(state.world.absolute_minute,calendar,routine);
        scheduleProcess(state,{due_absolute_minute:next.absolute_minute,owner_id:npc.id,kind:'npc_routine_boundary',priority:20,fidelity:'local',payload:{routine_id:routine.routine_id,boundary_kind:next.kind,known_by:['internal'],player_relevance:1,consequence:1}});
        npc.scheduler.next_routine_boundary_absolute_minute=next.absolute_minute;
      }
    }

    const travel=state.projects?.travel;
    if (travel) {
      if (travel.start_absolute_minute==null && travel.start_minute!=null) travel.start_absolute_minute=startAbsolute+Number(travel.start_minute);
      if (travel.last_update_absolute_minute==null && travel.last_update_minute!=null) travel.last_update_absolute_minute=startAbsolute+Number(travel.last_update_minute);
      delete travel.start_minute; delete travel.last_update_minute;
    }
    for (const craft of Object.values(state.projects?.crafts||{})) {
      if (craft.start_absolute_minute==null && craft.start_minute!=null) craft.start_absolute_minute=startAbsolute+Number(craft.start_minute);
      delete craft.start_minute;
    }
    for (const exposure of state.environment?.exposures||[]) {
      if (exposure.onset_absolute_minute==null && exposure.onset_minute!=null) exposure.onset_absolute_minute=startAbsolute+Number(exposure.onset_minute);
      delete exposure.onset_minute;
    }
    for (const threat of state.pc?.health?.active_threats||[]) {
      if (threat.due_absolute_minute==null && threat.due_minute!=null) threat.due_absolute_minute=startAbsolute+Number(threat.due_minute);
      delete threat.due_minute;
    }
    refreshTimeViews(state);
    state.meta.schema_version=3;
    migrated=true;
  }

  if ((state.meta?.schema_version||3) < 4) {
    migratePersistentLocations(state);
    state.meta.schema_version=4;
    migrated=true;
  }

  state.meta.rules_version=CORE.rulesVersion;
  return {state,migrated,from_schema:originalSchema,to_schema:state.meta.schema_version};
}
