import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
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
  if(errors.length)throw Error('Browser script errors: '+errors.join(' | '));
  console.log('PASS: Mobile-size browser character creation, review, commit, action, persisted reload and scene rendering.');
  await context.close();
}finally{
  if(browser)await browser.close();
  await new Promise(ok=>server.close(ok));
}
