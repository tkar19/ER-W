import { DEFAULT_WORLD_CALENDAR, calendarMetrics, isRoutineActiveAt, nextRoutineBoundary } from './calendar.mjs';
import { scheduleProcess } from './scheduler.mjs';
import { ensureNpcCognition } from './cognition.mjs';
import { currentLocationId } from './world_foundation.mjs';

export function addNpcRoutine(npc,routine,calendar=DEFAULT_WORLD_CALENDAR){
  ensureNpcCognition(npc);
  if(!routine?.routine_id) throw new Error('NPC routine requires routine_id.');
  const minutesPerDay=calendarMetrics(calendar).minutes_per_day;
  if(!Number.isInteger(routine.start_minute_of_day)||routine.start_minute_of_day<0||routine.start_minute_of_day>=minutesPerDay) throw new Error('NPC routine start time is invalid.');
  if(!Number.isInteger(routine.end_minute_of_day)||routine.end_minute_of_day<0||routine.end_minute_of_day>=minutesPerDay) throw new Error('NPC routine end time is invalid.');
  if(npc.scheduler.routines.some(r=>r.routine_id===routine.routine_id)) throw new Error('Duplicate NPC routine ID.');
  const normalized={
    routine_id:routine.routine_id,
    label:routine.label||routine.routine_id,
    weekday_indices:Array.isArray(routine.weekday_indices)?[...routine.weekday_indices]:[0,1,2,3,4,5,6],
    start_minute_of_day:routine.start_minute_of_day,
    end_minute_of_day:routine.end_minute_of_day,
    active_location_id:routine.active_location_id||npc.location_id,
    inactive_location_id:routine.inactive_location_id,
    activity:routine.activity||'routine',
  };
  npc.scheduler.routines.push(normalized);
  return normalized;
}

function setPresence(state,npc,present){
  state.scene.present_npc_ids ||= [];
  const idx=state.scene.present_npc_ids.indexOf(npc.id);
  if(present && idx<0) state.scene.present_npc_ids.push(npc.id);
  if(!present && idx>=0) state.scene.present_npc_ids.splice(idx,1);
}

export function synchronizeNpcRoutine(state,npcId,routineId,absoluteMinute=state.world.absolute_minute){
  const npc=state.npcs[npcId]; if(!npc) throw new Error('Unknown NPC for routine synchronization.');
  ensureNpcCognition(npc);
  const routine=npc.scheduler.routines.find(r=>r.routine_id===routineId); if(!routine) throw new Error('Unknown NPC routine.');
  const active=isRoutineActiveAt(absoluteMinute,state.world.calendar,routine);
  if(!routine.active_location_id||!routine.inactive_location_id)throw new Error('NPC routine requires persistent location IDs.');
  npc.location_id=active?routine.active_location_id:routine.inactive_location_id;
  npc.adaptive.current_activity=active?routine.activity:'off_duty';
  setPresence(state,npc,active && npc.location_id===currentLocationId(state));
  return {active,location_id:npc.location_id,activity:npc.adaptive.current_activity};
}

export function scheduleNextNpcRoutineBoundary(state,npcId,routineId,afterAbsoluteMinute=state.world.absolute_minute){
  const npc=state.npcs[npcId]; if(!npc) throw new Error('Unknown NPC for routine scheduling.');
  const routine=npc.scheduler.routines.find(r=>r.routine_id===routineId); if(!routine) throw new Error('Unknown NPC routine.');
  const boundary=nextRoutineBoundary(afterAbsoluteMinute,state.world.calendar,routine);
  const process=scheduleProcess(state,{
    due_absolute_minute:boundary.absolute_minute,
    owner_id:npcId,
    kind:'npc_routine_boundary',
    priority:20,
    fidelity:'local',
    payload:{routine_id:routineId,boundary_kind:boundary.kind,known_by:['internal'],player_relevance:1,consequence:1},
  });
  npc.scheduler.next_routine_boundary_absolute_minute=boundary.absolute_minute;
  return process;
}

export function applyNpcRoutineBoundary(state,process){
  const npc=state.npcs[process.owner_id]; if(!npc) return {applied:false,reason:'missing_npc'};
  const routine=npc.scheduler?.routines?.find(r=>r.routine_id===process.payload?.routine_id); if(!routine) return {applied:false,reason:'missing_routine'};
  const was_present=(state.scene.present_npc_ids||[]).includes(npc.id);
  const previous_location_id=npc.location_id;
  const justAfter=process.due_absolute_minute+1;
  const sync=synchronizeNpcRoutine(state,npc.id,routine.routine_id,justAfter);
  const is_present=(state.scene.present_npc_ids||[]).includes(npc.id);
  const next=nextRoutineBoundary(process.due_absolute_minute,state.world.calendar,routine);
  npc.scheduler.next_routine_boundary_absolute_minute=next.absolute_minute;
  return {
    applied:true,
    npc_id:npc.id,
    routine_id:routine.routine_id,
    active:sync.active,
    location_id:sync.location_id,
    previous_location_id,
    was_present,
    is_present,
    witnessed_by_pc:was_present||is_present,
    activity:sync.activity,
    next_followup:{
      due_absolute_minute:next.absolute_minute,
      owner_id:npc.id,
      kind:'npc_routine_boundary',
      priority:20,
      fidelity:'local',
      payload:{routine_id:routine.routine_id,boundary_kind:next.kind,known_by:['internal'],player_relevance:1,consequence:1},
    }
  };
}

export function refreshScheduledNpcPresence(state){
  for(const npc of Object.values(state.npcs||{})){
    if(!npc.scheduler?.routines?.length) continue;
    const routine=npc.scheduler.routines[0];
    synchronizeNpcRoutine(state,npc.id,routine.routine_id,state.world.absolute_minute);
  }
  return [...(state.scene.present_npc_ids||[])];
}
