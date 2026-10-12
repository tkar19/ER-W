import { parseDurationMinutes } from './util.mjs';

export const INTENT_SCHEMA = {
  type:'object', additionalProperties:false,
  required:['action_type','summary','target','duration_minutes','distance_km','skill','attribute','difficulty','method','is_pc_voluntary'],
  properties:{
    action_type:{type:'string',enum:['LOOK','INVESTIGATE','TALK','TRAVEL','MAGIC','WAIT','REST','COMBAT','STEALTH','CRAFT','OTHER']},
    summary:{type:'string'}, target:{type:['string','null']}, duration_minutes:{type:['integer','null'],minimum:0},
    distance_km:{type:['number','null'],minimum:0,maximum:100000}, skill:{type:['string','null']},
    attribute:{type:['string','null'],enum:['Might','Agility','Endurance','Awareness','Intellect','Will','Presence',null]},
    difficulty:{type:'string',enum:['auto','easy','standard','hard','formidable','extreme','legendary']},
    method:{type:['string','null']}, is_pc_voluntary:{type:'boolean'}
  }
};

export function localIntent(text, context={}) {
  const s=String(text||'').trim(); const l=s.replace(/["“][^"”]*["”]/g,' ').toLowerCase();
  let action_type='OTHER';
  if (/^(?:i\s+)?(?:look|observe|survey|scan)\b|^(?:i\s+)?(?:have|take)\s+a\s+look\b/.test(l)) action_type='LOOK';
  else if (/(investigate|inspect|search|examine|study)\b/.test(l)) action_type='INVESTIGATE';
  else if (/(talk|speak|ask|tell|say|greet|reply|answer|persuade|convince|deceive|lie|intimidate|negotiate|bargain)\b/.test(l)) action_type='TALK';
  else if (/(travel|walk|ride|go |head |move |journey|leave for)\b/.test(l)) action_type='TRAVEL';
  else if (/(cast|spell|magic|enchant|conjure|summon)\b/.test(l)) action_type='MAGIC';
  else if (/(wait|pass time)\b/.test(l)) action_type='WAIT';
  else if (/(rest|sleep|camp)\b/.test(l)) action_type='REST';
  else if (/(attack|fight|strike|shoot|stab|parry|duel|surrender|retreat|withdraw|disengage|flee)\b/.test(l)) action_type='COMBAT';
  else if (/(sneak|hide|stealth|pickpocket|shadow)\b/.test(l)) action_type='STEALTH';
  else if (/(craft|make|forge|brew|repair|build)\b/.test(l)) action_type='CRAFT';

  const defaults={
    LOOK:[null,'Awareness','auto'], INVESTIGATE:['Investigation','Intellect','standard'], TALK:['Persuasion','Presence','auto'],
    TRAVEL:['Survival','Endurance','auto'], MAGIC:['Arcana','Intellect','standard'], WAIT:[null,null,'auto'], REST:[null,'Endurance','auto'],
    COMBAT:['Melee','Agility','standard'], STEALTH:['Stealth','Agility','standard'], CRAFT:['Crafting','Intellect','standard'], OTHER:[null,null,'auto'],
  }[action_type];
  let target=null;
  if(action_type==='TRAVEL'){
    const m=s.match(/(?:to|toward|towards|into|through)\s+(.+)$/i);
    target=m?m[1].trim().replace(/[.!?,;:]+$/,'').trim().slice(0,120):(/south|north|east|west/i.exec(s)?.[0]??null);
  }
  const duration_minutes=parseDurationMinutes(s,context?.state?.world?.calendar);
  let distance_km=null; const dm=s.match(/(\d+(?:\.\d+)?)\s*(?:km|kilomet(?:er|re)s?)\b/i); if(dm) distance_km=Number(dm[1]);
  let method=null;
  if(action_type==='INVESTIGATE') method=/arcane|magic/i.test(s)?'arcane_analysis':/question|interview/i.test(s)?'interview':'search';
  if(action_type==='TALK'){
    if(/intimidat|threat/i.test(l)) defaults[0]='Intimidation';
    else if(/deceiv|lie|bluff/i.test(l)) defaults[0]='Deception';
  }
  if(action_type==='COMBAT' && /shoot|bow|arrow|throw|ranged/i.test(s)) defaults[0]='Ranged';
  return {action_type,summary:s.slice(0,300),target,duration_minutes,distance_km,skill:defaults[0],attribute:defaults[1],difficulty:defaults[2],method,is_pc_voluntary:true};
}
