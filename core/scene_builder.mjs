import { sha256 } from './util.mjs';
import { currentLocationId } from './world_foundation.mjs';

export const SCENE_PROJECTION=Object.freeze({contract:'ER_PLAYER_SCENE_PROJECTION_V1'});

function playerAwareOf(state,viewpointId,subjectId){
  const record=state.perception?.observers?.[viewpointId]?.awareness_of?.[subjectId];
  if(record)return record.current_awareness==='observed';
  // Compatibility only: pre-3D saves did not record PC observer state. A known NPC
  // already present in the legacy scene may remain visible until the next cue.
  return state.npcs?.[subjectId]?.known_to_pc===true&&(state.scene?.present_npc_ids||[]).includes(subjectId);
}

function visibleNpcIds(state,viewpointId,locationId){
  return Object.values(state.npcs||{})
    .filter(npc=>npc.location_id===locationId&&playerAwareOf(state,viewpointId,npc.id))
    .map(npc=>npc.id).sort();
}

function visibleEvidence(state,viewpointId,locationId){
  return (state.scene?.evidence||[])
    .filter(evidence=>evidence.location_id===locationId&&!evidence.destroyed&&(
      evidence.known_by?.includes(viewpointId)||evidence.known_by?.includes('public')||evidence.discovered_by?.includes(viewpointId)
    ))
    .map(evidence=>structuredClone(evidence))
    .sort((a,b)=>a.evidence_id.localeCompare(b.evidence_id));
}

function visibleExits(state,locationId){
  return Object.values(state.world?.local_connections||{})
    .filter(connection=>connection.from_location_id===locationId&&(
      !connection.visibility_rules?.length||connection.visibility_rules.includes('public')
    ))
    .map(connection=>({
      connection_id:connection.connection_id,
      connection_type:connection.connection_type,
      to_location_id:connection.to_location_id,
      label:state.world.locations[connection.to_location_id]?.label||'Unknown destination',
      travel_minutes:connection.travel_minutes,
      accessible:connection.condition==='open'&&!connection.restrictions?.length&&!connection.access_rules?.length,
    }))
    .sort((a,b)=>a.connection_id.localeCompare(b.connection_id));
}

export function derivePlayerScene(state,{viewpointId='pc_1'}={}){
  const locationId=currentLocationId(state),location=state.world?.locations?.[locationId];
  if(!location)throw new Error('Scene Builder requires a persistent viewpoint location.');
  const npcIds=visibleNpcIds(state,viewpointId,locationId);
  const evidence=visibleEvidence(state,viewpointId,locationId);
  const exits=visibleExits(state,locationId);
  const environment={weather:String(state.world?.weather||'Unresolved')};
  const core={
    contract_id:SCENE_PROJECTION.contract,
    viewpoint_id:viewpointId,
    location_id:locationId,
    location_label:location.label,
    summary:`${location.label}. ${environment.weather}. ${npcIds.length} perceived ${npcIds.length===1?'person is':'people are'} present.`,
    visible_npc_ids:npcIds,
    visible_evidence:evidence,
    exits,
    environment,
    provenance:{authority:'derived_projection',source:'world_perception_state'},
  };
  return {...core,projection_id:`scene_${sha256(core).slice(0,24)}`};
}
