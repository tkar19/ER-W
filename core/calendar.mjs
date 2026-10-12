import { deepClone } from './util.mjs';

export const DEFAULT_WORLD_CALENDAR = Object.freeze({
  calendar_id:'realm_common_v1',
  display_name:'Common Realm Calendar',
  minutes_per_hour:60,
  hours_per_day:24,
  weekdays:['Moonday','Emberday','Tideday','Stoneday','Windday','Starday','Restday'],
  months:[
    {name:'Frostwane',days:30,season:'Deepwinter'},
    {name:'Thawrise',days:30,season:'Latewinter'},
    {name:'Greenwake',days:30,season:'Spring'},
    {name:'Raincall',days:30,season:'Spring'},
    {name:'Suncrest',days:30,season:'Earlysummer'},
    {name:'Highsun',days:30,season:'Highsummer'},
    {name:'Goldreach',days:30,season:'Latesummer'},
    {name:'Emberfall',days:30,season:'Autumn'},
    {name:'Harvestend',days:30,season:'Autumn'},
    {name:'Duskwane',days:30,season:'Lateautumn'},
    {name:'Longnight',days:30,season:'Earlywinter'},
    {name:'Starrest',days:30,season:'Deepwinter'},
  ],
  year_label:'Year',
});

export const DEFAULT_WORLD_START = Object.freeze({year:842,month_index:0,day:17,hour:9,minute:0});

export function cloneDefaultCalendar(){ return deepClone(DEFAULT_WORLD_CALENDAR); }

export function calendarMetrics(calendar=DEFAULT_WORLD_CALENDAR){
  const minutesPerHour=Number(calendar?.minutes_per_hour);
  const hoursPerDay=Number(calendar?.hours_per_day);
  if(!Number.isInteger(minutesPerHour)||minutesPerHour<=0) throw new Error('World calendar minutes_per_hour must be a positive integer.');
  if(!Number.isInteger(hoursPerDay)||hoursPerDay<=0) throw new Error('World calendar hours_per_day must be a positive integer.');
  return {minutes_per_hour:minutesPerHour,hours_per_day:hoursPerDay,minutes_per_day:minutesPerHour*hoursPerDay};
}

export function daysPerYear(calendar=DEFAULT_WORLD_CALENDAR){
  return calendar.months.reduce((sum,m)=>sum+Number(m.days),0);
}

export function minuteOfWorldDay(hour,minute=0,calendar=DEFAULT_WORLD_CALENDAR){
  const metrics=calendarMetrics(calendar);
  if(!Number.isInteger(hour)||hour<0||hour>=metrics.hours_per_day) throw new Error('World calendar hour is invalid.');
  if(!Number.isInteger(minute)||minute<0||minute>=metrics.minutes_per_hour) throw new Error('World calendar minute is invalid.');
  return hour*metrics.minutes_per_hour+minute;
}

export function dateToAbsoluteMinute(date,calendar=DEFAULT_WORLD_CALENDAR){
  const year=Number(date.year), mi=Number(date.month_index), day=Number(date.day), hour=Number(date.hour||0), minute=Number(date.minute||0);
  const metrics=calendarMetrics(calendar);
  if(!Number.isInteger(year)||year<1) throw new Error('World calendar year must be a positive integer.');
  if(!Number.isInteger(mi)||mi<0||mi>=calendar.months.length) throw new Error('World calendar month index is invalid.');
  const monthDays=Number(calendar.months[mi].days);
  if(!Number.isInteger(day)||day<1||day>monthDays) throw new Error('World calendar day is invalid.');
  if(!Number.isInteger(hour)||hour<0||hour>=metrics.hours_per_day) throw new Error('World calendar hour is invalid.');
  if(!Number.isInteger(minute)||minute<0||minute>=metrics.minutes_per_hour) throw new Error('World calendar minute is invalid.');
  const priorYears=(year-1)*daysPerYear(calendar);
  const priorMonths=calendar.months.slice(0,mi).reduce((sum,m)=>sum+Number(m.days),0);
  const absoluteDay=priorYears+priorMonths+(day-1);
  return absoluteDay*metrics.minutes_per_day + hour*metrics.minutes_per_hour + minute;
}

export function absoluteMinuteToDate(absoluteMinute,calendar=DEFAULT_WORLD_CALENDAR){
  if(!Number.isFinite(absoluteMinute)||absoluteMinute<0) throw new Error('Absolute world minute must be non-negative.');
  const whole=Math.floor(absoluteMinute+1e-9);
  const metrics=calendarMetrics(calendar);
  const minutesPerDay=metrics.minutes_per_day;
  const wholeDay=Math.floor(whole/minutesPerDay);
  let dayInYear=wholeDay%daysPerYear(calendar);
  const year=Math.floor(wholeDay/daysPerYear(calendar))+1;
  let month_index=0;
  while(dayInYear>=calendar.months[month_index].days){ dayInYear-=calendar.months[month_index].days; month_index+=1; }
  const minuteOfDay=whole%minutesPerDay;
  const hour=Math.floor(minuteOfDay/metrics.minutes_per_hour);
  const minute=minuteOfDay%metrics.minutes_per_hour;
  const weekday_index=wholeDay%calendar.weekdays.length;
  return {year,month_index,month:calendar.months[month_index].name,day:dayInYear+1,hour,minute,weekday_index,weekday:calendar.weekdays[weekday_index],season:calendar.months[month_index].season};
}

export function formatWorldTime(absoluteMinute,calendar=DEFAULT_WORLD_CALENDAR){
  const d=absoluteMinuteToDate(absoluteMinute,calendar);
  const hh=String(d.hour).padStart(2,'0'), mm=String(d.minute).padStart(2,'0');
  return {...d,clock:`${hh}:${mm}`,label:`${d.weekday}, ${d.day} ${d.month}, ${calendar.year_label} ${d.year} · ${hh}:${mm}`,short_label:`${d.day} ${d.month} ${d.year} · ${hh}:${mm}`};
}

export function campaignElapsedView(elapsedMinute,calendar=DEFAULT_WORLD_CALENDAR){
  if(!Number.isFinite(elapsedMinute)||elapsedMinute<0) throw new Error('Campaign elapsed minute must be non-negative.');
  const metrics=calendarMetrics(calendar);
  const whole=Math.floor(elapsedMinute+1e-9), day=Math.floor(whole/metrics.minutes_per_day)+1, minuteOfDay=whole%metrics.minutes_per_day;
  const hh=String(Math.floor(minuteOfDay/metrics.minutes_per_hour)).padStart(2,'0'), mm=String(minuteOfDay%metrics.minutes_per_hour).padStart(2,'0');
  return {day,elapsed_minute:elapsedMinute,clock:`${hh}:${mm}`,label:`Campaign Day ${day} · +${hh}:${mm}`};
}

export function refreshTimeViews(state){
  const cal=state.world.calendar;
  state.world.world_time=formatWorldTime(state.world.absolute_minute,cal);
  state.world.time_label=state.world.world_time.label;
  state.campaign_clock ||= {start_absolute_minute:state.world.absolute_minute,elapsed_minute:0};
  state.campaign_clock.elapsed=campaignElapsedView(state.campaign_clock.elapsed_minute,cal);
  return state;
}

function routineRunsOnWeekday(routine,weekdayIndex){
  return !Array.isArray(routine.weekday_indices)||routine.weekday_indices.length===0||routine.weekday_indices.includes(weekdayIndex);
}

export function isRoutineActiveAt(absoluteMinute,calendar,routine){
  const d=absoluteMinuteToDate(absoluteMinute,calendar), minuteOfDay=d.hour*calendarMetrics(calendar).minutes_per_hour+d.minute;
  const start=Number(routine.start_minute_of_day), end=Number(routine.end_minute_of_day);
  if(start===end) return routineRunsOnWeekday(routine,d.weekday_index);
  if(start<end) return routineRunsOnWeekday(routine,d.weekday_index)&&minuteOfDay>=start&&minuteOfDay<end;
  // Overnight routine: the late portion belongs to the current weekday's shift;
  // the early portion belongs to the shift that began on the previous weekday.
  if(minuteOfDay>=start) return routineRunsOnWeekday(routine,d.weekday_index);
  const previousWeekday=(d.weekday_index-1+calendar.weekdays.length)%calendar.weekdays.length;
  return minuteOfDay<end&&routineRunsOnWeekday(routine,previousWeekday);
}

export function nextRoutineBoundary(absoluteMinute,calendar,routine){
  const minutesPerDay=calendarMetrics(calendar).minutes_per_day;
  const now=Math.floor(absoluteMinute+1e-9);
  const currentDay=Math.floor(now/minutesPerDay);
  const start=Number(routine.start_minute_of_day), end=Number(routine.end_minute_of_day);
  const candidates=[];
  // Treat each eligible weekday as a potential shift start. For an overnight
  // routine the end boundary belongs to the following calendar day.
  for(let dayOffset=-1;dayOffset<16;dayOffset++){
    const shiftDay=currentDay+dayOffset;
    if(shiftDay<0) continue;
    const shiftStart=shiftDay*minutesPerDay+start;
    const shiftDate=absoluteMinuteToDate(shiftStart,calendar);
    if(!routineRunsOnWeekday(routine,shiftDate.weekday_index)) continue;
    const shiftEnd=shiftDay*minutesPerDay+(start===end?minutesPerDay+end:(start<end?end:minutesPerDay+end));
    if(shiftStart>now) candidates.push({kind:'start',absolute_minute:shiftStart});
    if(shiftEnd>now) candidates.push({kind:'end',absolute_minute:shiftEnd});
  }
  candidates.sort((a,b)=>a.absolute_minute-b.absolute_minute||(a.kind==='end'?-1:1));
  if(candidates.length) return candidates[0];
  throw new Error('Could not find next NPC routine boundary.');
}
