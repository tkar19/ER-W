import { sha256 } from './util.mjs';
import { WORLD_FOUNDATION, validateWorldGenerationManifest } from './world_foundation.mjs';

export function deterministicInt(seed, tag, min, max) {
  const digest=sha256(`${seed}|${tag}`);
  const raw=Number.parseInt(digest.slice(0,8),16)>>>0;
  const span=max-min+1;
  return min+(raw%span);
}

export function keyedDeterministicInt(state,namespace,identity,propertyTag,min,max){
  validateWorldGenerationManifest(state.world_generation_manifest,state);
  if(state.rng.contract_version!==WORLD_FOUNDATION.randomnessContract)throw new Error('Unsupported randomness namespace contract.');
  if(typeof namespace!=='string'||!namespace.trim()||typeof propertyTag!=='string'||!propertyTag.trim())throw new Error('Deterministic namespace and property tag are required.');
  const key=Array.isArray(identity)?identity:[identity];
  if(key.some(x=>typeof x!=='string'&&!Number.isFinite(x)))throw new Error('Invalid deterministic namespace identity.');
  return deterministicInt(state.rng.seed,`${state.rng.contract_version}|${namespace}|${key.join('|')}|${propertyTag}`,min,max);
}

export function rollD20(state, tag='check') {
  if(state.rng.contract_version&&state.rng.contract_version!==WORLD_FOUNDATION.randomnessContract)throw new Error('Unsupported gameplay randomness contract.');
  const index=state.rng.roll_index;
  const fullTag=`${state.meta.campaign_id}|g${state.meta.generation}|r${index}|${tag}`;
  const value=deterministicInt(state.rng.seed,fullTag,1,20);
  state.rng.roll_index+=1;
  return {sides:20,value,index,tag,proof:sha256(`${state.rng.seed}|${fullTag}`).slice(0,16)};
}
