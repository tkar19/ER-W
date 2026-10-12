import { clamp, sha256 } from './util.mjs';
import { scheduleProcess } from './scheduler.mjs';
import { calendarMetrics } from './calendar.mjs';
import { setPcLocation } from './world_foundation.mjs';

export function normalizeItem(item, sourceEventId=null) {
  const out={
    id:item.id,name:item.name,quantity:Number(item.quantity??1),load:Number(item.load ?? item.mass ?? 0),tags:[...(item.tags||[])],
    condition:item.condition || 'sound',defects:[...(item.defects||[])],owner_id:item.owner_id??null,holder_id:item.holder_id??null,
    container_id:item.container_id??null,location_id:item.location_id??null,custodian_id:item.custodian_id??null,
    access:item.access||'stowed',source_event_id:item.source_event_id||sourceEventId,
  };
  const placement=[out.holder_id,out.container_id,out.location_id].filter(x=>x!==null);
  if (placement.length>1) throw new Error(`Item ${out.id} has conflicting physical placement.`);
  return out;
}

export function carriedItemIds(state,holderId) {
  const items=state.inventory.items; const result=new Set(); const stack=Object.values(items).filter(i=>i.holder_id===holderId).map(i=>i.id);
  while(stack.length){const id=stack.pop();if(result.has(id))continue;result.add(id);for(const item of Object.values(items))if(item.container_id===id)stack.push(item.id);} return [...result];
}
export function carriedLoad(state,holderId) { return carriedItemIds(state,holderId).reduce((n,id)=>n+Number(state.inventory.items[id].load ?? state.inventory.items[id].mass ?? 0)*Number(state.inventory.items[id].quantity||1),0); }
export function loadBand(state,holderId='pc_1') {
  const load=carriedLoad(state,holderId); const capacity=Math.max(0.1,Number(state.pc.carry_capacity||10)); const ratio=load/capacity;
  return {load,capacity,band:ratio<=0.35?'light':ratio<=0.75?'normal':ratio<=1?'encumbered':'overloaded'};
}

export function itemAccessMinutes(item) {
  return ({readied:0,worn:0,held:0,stowed:0.25,packed:1,secured:2}[item?.access] ?? 0.5);
}

export function travelRateKmh(state,{base_rate=5,terrain_factor=1,pace='normal',activity='travel'}={}) {
  const paceFactor={slow:0.75,normal:1,fast:1.2}[pace]||1; const actFactor={travel:1,search:0.55,scout:0.7,forage:0.6,map:0.65,guard:0.8,avoid_notice:0.7}[activity]||1;
  const band=loadBand(state).band; const loadFactor={light:1.05,normal:1,encumbered:0.75,overloaded:0.4}[band];
  return Math.max(0.1,base_rate*terrain_factor*paceFactor*actFactor*loadFactor);
}

export function startTravel(state,{target_location_id,total_distance_km,route_id=null,base_rate=5,terrain_factor=1,activity='travel',pace='normal',group_member_rates=[]}) {
  if (!state.world.locations?.[target_location_id] || !(Number(total_distance_km)>0)) throw new Error('Travel requires an established target location and positive distance.');
  const id=`travel_${sha256({campaign:state.meta.campaign_id,g:state.meta.generation,target_location_id,total_distance_km,route_id}).slice(0,18)}`;
  const p={project_id:id,type:'travel',route_id:route_id||id,target_location_id,total_distance_km:Number(total_distance_km),completed_distance_km:0,remaining_distance_km:Number(total_distance_km),base_rate,terrain_factor,activity,pace,group_member_rates:[...group_member_rates],start_absolute_minute:state.world.absolute_minute,last_update_absolute_minute:state.world.absolute_minute,status:'active'};
  state.projects.travel=p; return p;
}

export function travelRateForProject(state,p) {
  let rate=travelRateKmh(state,p);
  const rates=(p.group_member_rates||[]).filter(x=>Number(x)>0).map(Number);
  if (rates.length) rate=Math.min(rate,...rates);
  return Math.max(0.1,rate);
}

export function minutesToCompleteTravel(state,p=state.projects.travel) {
  if(!p||p.status!=='active') return 0;
  return (p.remaining_distance_km/travelRateForProject(state,p))*calendarMetrics(state.world.calendar).minutes_per_hour;
}

export function advanceTravel(state,minutes) {
  const p=state.projects.travel; if(!p||p.status!=='active') throw new Error('No active travel project.');
  const minutesPerHour=calendarMetrics(state.world.calendar).minutes_per_hour;
  const rate=travelRateForProject(state,p); const distance=Math.min(p.remaining_distance_km,rate*(minutes/minutesPerHour));
  p.completed_distance_km=Number((p.completed_distance_km+distance).toFixed(6)); p.remaining_distance_km=Number(Math.max(0,p.total_distance_km-p.completed_distance_km).toFixed(6));
  p.last_update_absolute_minute=Number((state.world.absolute_minute+minutes).toFixed(6));
  if(p.remaining_distance_km<=1e-9){p.remaining_distance_km=0;p.status='complete';setPcLocation(state,p.target_location_id);}
  return {distance_km:distance,rate_kmh:rate,project:p};
}

export function startCraftProject(state,{recipe_id='generic',output_name='Crafted Item',required_progress=4,work_interval_minutes=null,required_materials=1,required_tool_tags=[],reserved_item_ids=[]}) {
  if(state.resources.materials<required_materials) throw new Error('Insufficient materials.');
  for (const id of reserved_item_ids) {
    const item=state.inventory.items[id]; if(!item) throw new Error(`Unknown reserved material item ${id}.`);
    if (Object.values(state.projects.crafts||{}).some(p=>p.status==='active' && p.reserved_item_ids?.includes(id))) throw new Error(`Material item ${id} is already reserved by another project.`);
  }
  const interval=work_interval_minutes==null?calendarMetrics(state.world.calendar).minutes_per_hour:Number(work_interval_minutes);
  if(!Number.isFinite(interval)||interval<=0) throw new Error('Craft work interval must be positive.');
  const id=`craft_${sha256({campaign:state.meta.campaign_id,g:state.meta.generation,recipe_id,output_name}).slice(0,18)}`;
  const p={project_id:id,type:'craft',recipe_id,output_name,required_progress:Number(required_progress),current_progress:0,work_interval_minutes:interval,worked_minutes_in_interval:0,required_materials:Number(required_materials),required_tool_tags:[...required_tool_tags],reserved_item_ids:[...reserved_item_ids],status:'active',reserved_materials:Number(required_materials),start_absolute_minute:state.world.absolute_minute};
  state.resources.materials-=required_materials; state.projects.crafts[id]=p; return p;
}

export function addCraftWorkTime(state,projectId,minutes) {
  const p=state.projects.crafts[projectId]; if(!p||p.status!=='active') throw new Error('Craft project is not active.');
  p.worked_minutes_in_interval += Number(minutes);
  const intervals=Math.floor((p.worked_minutes_in_interval+1e-9)/p.work_interval_minutes);
  p.worked_minutes_in_interval = Number((p.worked_minutes_in_interval - intervals*p.work_interval_minutes).toFixed(6));
  return {project:p,completed_intervals:intervals};
}

export function workCraftInterval(state,projectId,outcome,effect='full') {
  const p=state.projects.crafts[projectId]; if(!p||p.status!=='active') throw new Error('Craft project is not active.');
  const base={severe_failure:0,failure:0,mixed:0.5,success:1,exceptional_success:2}[outcome]??0;
  const ef={limited:0.5,full:1,amplified:1.5}[effect]||1; p.current_progress=Number(Math.min(p.required_progress,p.current_progress+base*ef).toFixed(3));
  if(p.current_progress>=p.required_progress)p.status='complete'; return p;
}

export function finishCraft(state,projectId,itemId,sourceEventId=null) {
  const p=state.projects.crafts[projectId]; if(!p||p.status!=='complete') throw new Error('Craft project is not complete.');
  const item=normalizeItem({id:itemId,name:p.output_name,quantity:1,load:1,tags:['crafted'],condition:'sound',owner_id:'pc_1',holder_id:'pc_1',custodian_id:'pc_1',access:'stowed'},sourceEventId||`project:${projectId}`);
  state.inventory.items[item.id]=item; p.status='delivered'; p.output_item_id=item.id; return item;
}

export function repairItem(state,{itemId,outcome='success',effect='full',materials=1}) {
  const item=state.inventory.items[itemId]; if(!item) throw new Error('Unknown item.');
  if(item.condition==='destroyed') throw new Error('Ordinary repair cannot restore a destroyed item.');
  if(state.resources.materials<materials) return {repaired:false,shortfall:materials-state.resources.materials,item};
  state.resources.materials-=materials;
  const order=['ruined','damaged','worn','sound']; let idx=order.indexOf(item.condition); if(idx<0)idx=2;
  const gain={severe_failure:0,failure:0,mixed:1,success:1,exceptional_success:effect==='amplified'?2:1}[outcome]??0;
  item.condition=order[Math.min(order.length-1,idx+gain)];
  if(gain>0 && item.defects.length) item.defects=item.defects.slice(Math.min(gain,item.defects.length));
  return {repaired:gain>0,shortfall:0,item,materials_consumed:materials};
}

export function createHazardExposure(state,{hazard_id,kind,interval_minutes=null,automatic=false,protection_tags=[],severity='moderate',consequence='fatigue'}) {
  const interval=interval_minutes==null?calendarMetrics(state.world.calendar).minutes_per_hour:Number(interval_minutes);
  if(!Number.isFinite(interval)||interval<=0) throw new Error('Hazard exposure interval must be positive.');
  const e={exposure_id:`exp_${sha256({hazard_id,onset:state.world.absolute_minute,count:state.environment.exposures.length}).slice(0,18)}`,hazard_id,kind,onset_absolute_minute:state.world.absolute_minute,interval_minutes:interval,automatic:Boolean(automatic),protection_tags:[...protection_tags],severity,consequence,status:'active',checkpoints_resolved:0};
  state.environment.exposures.push(e);
  scheduleHazardCheckpoint(state,e,1);
  return e;
}

function hazardProcessId(exposureId,checkpoint){return `hazard_${sha256({exposureId,checkpoint}).slice(0,20)}`;}

export function scheduleHazardCheckpoint(state,exposure,checkpoint){
  if(!exposure||exposure.status!=='active') return null;
  const due=exposure.onset_absolute_minute+Number(checkpoint)*Number(exposure.interval_minutes);
  const processId=hazardProcessId(exposure.exposure_id,checkpoint);
  if((state.scheduler.pending||[]).some(p=>p.process_id===processId)) return null;
  return scheduleProcess(state,{process_id:processId,due_absolute_minute:Math.max(due,state.scheduler.absolute_minute),owner_id:'world',kind:'hazard_checkpoint',priority:30,fidelity:'local',payload:{exposure_id:exposure.exposure_id,checkpoint,original_due_absolute_minute:due,player_relevance:3,consequence:3}});
}

export function ensureHazardProcesses(state){
  for(const exposure of state.environment.exposures||[]){
    if(exposure.status!=='active') continue;
    const checkpoint=Number(exposure.checkpoints_resolved||0)+1;
    scheduleHazardCheckpoint(state,exposure,checkpoint);
  }
}

export function dueHazardCheckpoints(state,startMinute,endMinute) {
  const due=[];
  for (const e of state.environment.exposures||[]) {
    if(e.status!=='active') continue;
    let n=e.checkpoints_resolved+1;
    while(e.onset_absolute_minute+n*e.interval_minutes<=endMinute+1e-9){
      const at=e.onset_absolute_minute+n*e.interval_minutes;
      if(at>startMinute+1e-9) due.push({exposure:e,due_absolute_minute:at,checkpoint:n});
      n++;
    }
  }
  return due.sort((a,b)=>a.due_absolute_minute-b.due_absolute_minute || a.exposure.exposure_id.localeCompare(b.exposure.exposure_id));
}

export function consumeResource(state,resource,amount) {
  const available=Math.max(0,Number(state.resources[resource]||0)); const used=Math.min(available,Number(amount)); state.resources[resource]=available-used; return {resource,requested:Number(amount),consumed:used,shortfall:Math.max(0,Number(amount)-used)};
}
