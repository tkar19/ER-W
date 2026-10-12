import {createServer} from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve, sep, extname} from 'node:path';
import {chromium} from 'playwright';

const root=process.cwd(), errors=[];
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.json':'application/json'};
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url||'/', 'http://127.0.0.1');
    if(!url.pathname.startsWith('/ER-W/')){res.writeHead(404);res.end();return}
    let name=decodeURIComponent(url.pathname.slice('/ER-W/'.length));
    if(!name||name.endsWith('/'))name+='index.html';
    const file=resolve(root,name);
    if(!file.startsWith(root+sep)){res.writeHead(403);res.end();return}
    const bytes=await readFile(file);
    res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});
    res.end(bytes);
  }catch{res.writeHead(404);res.end('Not found')}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const address=server.address(),base='http://127.0.0.1:'+address.port+'/ER-W/';
let browser;
try{
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true,deviceScaleFactor:2});
  const page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  await mkdir('screenshots',{recursive:true});
  await page.goto(base,{waitUntil:'networkidle',timeout:90000});
  await page.locator('#newCampaignBtn').waitFor({state:'visible',timeout:60000});
  await page.screenshot({path:'screenshots/welcome-mobile.png',fullPage:true});
  await page.locator('#newCampaignBtn').click();
  await page.locator('#creationDialog').waitFor({state:'visible'});
  const answers=[
    'Aster Vale','19','Half-elf','Nonbinary','Explorer',
    'Brown hair, a scar across my chin','I grew up by the sea','I want to learn what lies beyond the mountains',
    'My aunt raised me in a tiny village by the sea. I liked helping my neighbours.',
    'I studied magic with my grandfather whenever we had time.',
    'My brother is my best friend, and I worry about him.',
    'I have a keepsake from my childhood.'
  ];
  for(const value of answers){
    await page.locator('#creationInput').fill(value);
    await page.locator('#creationNext').click();
  }
  await page.locator('#creationSummary').waitFor({state:'visible',timeout:30000});
  const review=await page.locator('#creationSummary').innerText();
  if(!review.includes('My aunt raised me')||!review.includes('I studied magic'))throw Error('Review omitted raw player history');
  if(await page.locator('#creationError').isVisible())throw Error('Review failed: '+await page.locator('#creationError').innerText());
  await page.screenshot({path:'screenshots/creation-review-mobile.png',fullPage:true});
  await page.locator('#creationNext').click();
  try{await page.locator('#gamePanel').waitFor({state:'visible',timeout:90000})}
  catch(error){throw Error('Generation zero did not open. '+(await page.locator('#creationError').innerText())+' '+error.message)}
  await page.locator('#sceneLocation').waitFor({state:'visible'});
  const location=await page.locator('#sceneLocation').innerText();
  if(!location)throw Error('Scene did not show the committed location');
  await page.screenshot({path:'screenshots/chronicle-mobile.png',fullPage:true});
  await page.locator('#actionInput').fill('I look around carefully.');
  await page.locator('#commitBtn').click();
  await page.waitForFunction(()=>document.querySelector('#generationText')?.textContent!=='G0',null,{timeout:90000});
  await page.reload({waitUntil:'networkidle',timeout:90000});
  await page.locator('#gamePanel').waitFor({state:'visible',timeout:90000});
  if(!((await page.locator('#generationText').innerText()).match(/G[1-9]\d*/)))throw Error('Committed action lost after browser reload');

  const report=[];
  const gen=async()=>Number((await page.locator('#generationText').innerText()).replace(/^G/,''));
  const play=async(text,expectCommit=true)=>{
    const before=await gen(),locationBefore=await page.locator('#locationText').innerText();
    await page.locator('#actionInput').fill(text);
    await page.locator('#commitBtn').click();
    try{await page.waitForFunction(()=>{const a=document.querySelector('#actionInput'),b=document.querySelector('#commitBtn');return a&&b&&!b.disabled&&a.value==='';},null,{timeout:20000})}catch(error){const message=await page.locator('#toast').innerText();await page.screenshot({path:'screenshots/audit-error.png',fullPage:true});throw Error('Action failed: '+text+' | UI: '+message+' | '+error.message)}
    const after=await gen(),locationAfter=await page.locator('#locationText').innerText();
    if(expectCommit?after!==before+1:after!==before)throw Error('Unexpected generation after "'+text+'": '+before+' -> '+after);
    const entry=(await page.locator('#chronicle .entry').last().innerText()).slice(-400);
    report.push({text,before,after,locationBefore,locationAfter,entry});
  };
  await play('What can I see?',false);
  await play('What time is it?',false);
  await play('I look around carefully.');
  await play('I ask the clerk about the Academy.');
  await play('I wait four hours.');
  await play('I search the immediate area for evidence.');
  await play('I cast magic cautiously.');
  await play('I craft a wooden staff.');
  await play('I hide behind a tree.');
  await play('I travel to a location that does not exist.');
  const currentGen=await gen(),lastLocation=await page.locator('#locationText').innerText();
  if(report.at(-1).locationBefore!==lastLocation)throw Error('Unknown destination teleported player');
  await page.locator('[data-view-target="character"]').click();
  await page.locator('#view-character').waitFor({state:'visible'});
  if(!(await page.locator('#vitals').innerText()).includes('Mana'))throw Error('Character panel missing vital information');
  await page.screenshot({path:'screenshots/audit-character.png',fullPage:true});
  await page.locator('[data-view-target="journal"]').click();
  await page.locator('#view-journal').waitFor({state:'visible'});
  await page.locator('[data-view-target="realm"]').click();
  await page.locator('#view-realm').waitFor({state:'visible'});
  const downloadEvent=page.waitForEvent('download',{timeout:30000});
  await page.locator('#realmExport').click();
  const download=await downloadEvent,savePath='screenshots/audit-save.ergpt.json';
  await download.saveAs(savePath);
  const save=JSON.parse(await readFile(savePath,'utf8'));
  if(!save.head||!save.generations||!save.campaign_id)throw Error('Export is missing canonical ancestry');
  if(save.head.generation!==currentGen)throw Error('Export generation inconsistent with game');
  await page.locator('[data-view-target="chronicle"]').click();
  await page.setViewportSize({width:320,height:700});
  await page.screenshot({path:'screenshots/audit-narrow-phone.png',fullPage:true});
  const size=await page.evaluate(()=>({screen:window.innerWidth,overflow:document.documentElement.scrollWidth}));
  if(size.overflow>size.screen+8)throw Error('320px layout causes horizontal overflow: '+JSON.stringify(size));
  await page.setViewportSize({width:393,height:852});
  await page.reload({waitUntil:'networkidle',timeout:90000});
  await page.locator('#gamePanel').waitFor({state:'visible',timeout:90000});
  if(await gen()!==currentGen)throw Error('Audit playthrough was not restored after reload');
  report.push({text:'Export and browser reload',before:currentGen,after:await gen(),locationAfter:await page.locator('#locationText').innerText()});
  await writeFile('screenshots/audit-playthrough.json',JSON.stringify({testedAt:new Date().toISOString(),campaignId:save.campaign_id,generation:await gen(),actions:report,narrowViewport:size,publicBundle:'ER-W'},null,2));
  console.log('AUDIT COMPLETE: '+report.length+' recorded gameplay checks, generation '+(await gen())+', exported ancestry and mobile navigation.');

  if(errors.length)throw Error('Browser script errors: '+errors.join(' | '));
  console.log('PASS: Mobile-size browser character creation, review, commit, action, persisted reload and scene rendering.');
  await context.close();
}finally{
  if(browser)await browser.close();
  await new Promise(ok=>server.close(ok));
}
