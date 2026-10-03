// Three synthetic accounts and a mocked API. Never writes to production.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE+'/index.mjs').href : 'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
const base=process.env.COMMUNITY_TEST_URL||'http://127.0.0.1:4203';
const A='10000000-0000-0000-0000-000000000001',B='10000000-0000-0000-0000-000000000002',C='10000000-0000-0000-0000-000000000003';
const tripId='20000000-0000-0000-0000-000000000001';
let counter=0,failFeed=false;const posts=[],comments=[],reactions=[],reports=[],calls=[],errors=[];
const id=()=>`30000000-0000-0000-0000-${String(++counter).padStart(12,'0')}`;
const author=user=>({display_name:user===A?'Traveler A':user===B?'Traveler B':'Traveler C',avatar_url:null});
const enrich=(row,user,isComment=false)=>({...row,...author(row.user_id),comment_count:comments.filter(c=>c.post_id===row.id&&!c.is_deleted).length,
  reply_count:comments.filter(c=>c.parent_comment_id===row.id).length,
  reactions:reactions.filter(r=>(isComment?r.comment_id:r.post_id)===row.id).reduce((all,r)=>({...all,[r.reaction_type]:(all[r.reaction_type]||0)+1}),{}),
  my_reaction:reactions.find(r=>(isComment?r.comment_id:r.post_id)===row.id&&r.user_id===user)?.reaction_type||null});
const timestamp=()=>new Date(Date.now()+counter*100).toISOString();
async function account(userId){
  const context=await browser.newContext();const user={id:userId,email:'synthetic@example.invalid',role:'authenticated',aud:'authenticated',user_metadata:{}};
  const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');const expiry=Math.floor(Date.now()/1000)+3600;
  await context.addInitScript(session=>localStorage.setItem('sb-ghrgzwfiiqeeamkhilfk-auth-token',JSON.stringify(session)),{
    access_token:`${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:userId,role:'authenticated',exp:expiry})}.test`,refresh_token:'test',token_type:'bearer',expires_at:expiry,expires_in:3600,user});
  await context.routeWebSocket('**/*',socket=>{if(new URL(socket.url()).hostname==='127.0.0.1')socket.connectToServer();else socket.close();});
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());if(url.hostname==='127.0.0.1')return route.continue();if(!url.hostname.endsWith('.supabase.co'))return route.abort();
    const name=url.pathname.split('/').pop(),body=request.postData()?request.postDataJSON():{},method=request.method(),target=url.searchParams.get('id')?.replace('eq.','');
    calls.push({user:userId,name,body,method});let data=[],status=200;
    if(url.pathname.includes('/auth/'))data=name==='user'?user:{user,access_token:'test',refresh_token:'test'};
    else if(name==='is_app_admin')data=false;
    else if(name==='profiles')data=[{id:userId,...author(userId)}];
    else if(name==='community_feed'){
      let found=posts.map(p=>enrich(p,userId));if(body.p_id)found=found.filter(p=>p.id===body.p_id);
      if(body.p_mine)found=found.filter(p=>p.user_id===userId);
      for(const [param,key] of [['p_airport','airport_code'],['p_category','category'],['p_origin','origin_airport'],['p_destination','destination_airport'],['p_date','travel_date']])if(body[param])found=found.filter(p=>p[key]===body[param]);
      if(body.p_search)found=found.filter(p=>JSON.stringify(p).toLowerCase().includes(body.p_search.toLowerCase()));
      found.sort((a,b)=>body.p_sort==='discussed'?(b.comment_count-a.comment_count)||b.created_at.localeCompare(a.created_at):b.created_at.localeCompare(a.created_at));
      const offset=body.p_offset||0;data={rows:found.slice(offset,offset+20),has_more:found.length>offset+20};if(failFeed){status=503;data={message:'Test feed outage'};}
    }else if(name==='community_comment_page'){
      const found=comments.filter(c=>c.post_id===body.p_post&&c.parent_comment_id===(body.p_parent||null)).sort((a,b)=>b.created_at.localeCompare(a.created_at));
      const offset=body.p_offset||0;data={rows:found.slice(offset,offset+20).map(c=>enrich(c,userId,true)),has_more:found.length>offset+20};
    }else if(name==='community_posts'){
      if(method==='POST'){assert.equal(Object.hasOwn(body,'user_id'),false);const row={...body,id:id(),user_id:userId,created_at:timestamp(),updated_at:timestamp()};posts.push(row);data=[row];}
      else if(method==='PATCH'){const row=posts.find(p=>p.id===target&&p.user_id===userId);if(row)Object.assign(row,body);data=row?[row]:[];}
      else if(method==='DELETE'){const index=posts.findIndex(p=>p.id===target&&p.user_id===userId);data=index>=0?posts.splice(index,1):[];}
    }else if(name==='community_comments'){
      if(method==='POST'){assert.equal(Object.hasOwn(body,'user_id'),false);const row={...body,id:id(),user_id:userId,is_deleted:false,created_at:timestamp(),updated_at:timestamp()};comments.push(row);data=[row];}
      else if(method==='PATCH'){const row=comments.find(c=>c.id===target&&c.user_id===userId);if(row)Object.assign(row,body,body.is_deleted?{content:'[Comment deleted]'}:{});data=row?[row]:[];}
    }else if(name==='community_toggle_reaction'){
      const index=reactions.findIndex(r=>r.user_id===userId&&r.post_id===body.p_post&&r.comment_id===body.p_comment);
      if(index>=0){if(reactions[index].reaction_type===body.p_type)reactions.splice(index,1);else reactions[index].reaction_type=body.p_type;}
      else reactions.push({user_id:userId,post_id:body.p_post,comment_id:body.p_comment,reaction_type:body.p_type});data=null;
    }else if(name==='community_reports'){assert.equal(Object.hasOwn(body,'reporter_user_id'),false);reports.push({...body,user_id:userId});data=null;}
    else if(name==='itineraries'||name==='public_itinerary_search')data=[{id:tripId,owner_id:A,origin_airport_code:'JFK',destination_airport_code:'DEL',start_date:'2099-12-01',end_date:'2099-12-02',notes:'PRIVATE TRIP NOTES',languages_known:['English'],contact_details:{contact_phone:'PRIVATE PHONE'}}];
    else if(name==='itinerary_legs')data=[{id:'leg',leg_order:1,origin_airport_code:'JFK',destination_airport_code:'DEL',flight_number:'AI102'}];
    if(request.headers()['accept']?.includes('application/vnd.pgrst.object+json')&&Array.isArray(data))data=data[0]||null;
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());return {context,page};
}
try{
  const a=await account(A),b=await account(B),c=await account(C);
  await a.page.goto(base+'/community');await a.page.getByText('No community posts yet. Start a conversation with other travelers.',{exact:true}).waitFor();
  await a.page.getByRole('link',{name:'Create Post',exact:true}).click();
  await a.page.getByLabel('Category *',{exact:true}).selectOption('Airport Update');await a.page.getByLabel('Title *',{exact:true}).fill('Long security line at Terminal 4');
  await a.page.getByLabel('Description *',{exact:true}).fill('Security screening is taking longer than usual this evening.');await a.page.getByLabel('Airport (optional)',{exact:true}).fill('JFK');
  await a.page.getByRole('button',{name:'Publish Post',exact:true}).click();await a.page.getByRole('heading',{name:'Long security line at Terminal 4'}).waitFor();
  const postId=posts[0].id;
  await b.page.goto(base+'/community/'+postId);await b.page.getByRole('heading',{name:'Long security line at Terminal 4'}).waitFor();
  assert.equal(await b.page.getByRole('link',{name:'Edit post',exact:true}).count(),0);
  await b.page.getByRole('button',{name:'Like',exact:true}).first().click();await b.page.locator('button[aria-label="Like"][aria-pressed="true"]').waitFor();assert.equal(reactions.length,1);
  await b.page.getByRole('button',{name:'Support',exact:true}).first().click();await b.page.locator('button[aria-label="Support"][aria-pressed="true"]').waitFor();assert.equal(reactions[0].reaction_type,'support');
  await b.page.getByRole('button',{name:'Support',exact:true}).first().click();await b.page.locator('button[aria-label="Support"][aria-pressed="false"]:not([disabled])').waitFor();assert.equal(reactions.length,0);
  await b.page.getByLabel('Add a comment').fill('Thanks for the airport update.');await b.page.getByRole('button',{name:'Post Comment',exact:true}).click();await b.page.getByText('Thanks for the airport update.',{exact:true}).waitFor();
  await c.page.goto(base+'/community/'+postId);await c.page.getByRole('button',{name:'Reply',exact:true}).click();await c.page.getByLabel('Your reply').fill('Terminal 2 was quieter earlier.');await c.page.getByRole('button',{name:'Post Reply',exact:true}).click();await c.page.getByText('Terminal 2 was quieter earlier.',{exact:true}).waitFor();
  assert.equal(await c.page.getByRole('button',{name:'Reply',exact:true}).count(),1);
  await c.page.locator('.comment').first().getByRole('button',{name:'Helpful',exact:true}).first().click();
  await a.page.getByRole('button',{name:'Refresh post'}).click();await a.page.getByText('Thanks for the airport update.',{exact:true}).waitFor();assert.equal(await a.page.getByRole('button',{name:'Edit comment',exact:true}).count(),0);
  await b.page.getByRole('button',{name:'Edit comment',exact:true}).click();await b.page.getByRole('textbox',{name:'Edit comment',exact:true}).fill('Updated airport comment.');await b.page.getByRole('button',{name:'Save Comment',exact:true}).click();await b.page.getByText('Updated airport comment.',{exact:true}).waitFor();
  await c.page.getByRole('button',{name:'Report post',exact:true}).click();await c.page.getByLabel('Reason',{exact:true}).selectOption('False / Misleading Information');await c.page.getByRole('button',{name:'Submit report'}).click();await c.page.getByText('Report submitted for review.').waitFor();assert.equal(reports.length,1);assert.equal(posts.length,1);
  await c.page.getByRole('button',{name:'Report comment',exact:true}).click();await c.page.getByLabel('Reason',{exact:true}).selectOption('Spam');await c.page.getByRole('button',{name:'Submit report'}).click();await c.page.locator('app-community-report').waitFor({state:'detached'});assert.equal(reports.length,2);
  await b.page.getByRole('button',{name:'Delete comment',exact:true}).click();await b.page.getByText('Comment deleted.',{exact:true}).waitFor();assert.equal(comments.filter(row=>!row.is_deleted).length,1);
  // Automation keeps documents focused/visible even when another tab is selected.
  // Explicitly deliver the browser lifecycle events and verify the app refetches.
  const away=await a.context.newPage();await away.goto('about:blank');
  for(let i=0;i<5;i++){
    await a.page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
    await away.bringToFront();await away.waitForTimeout(1200);const before=calls.filter(call=>call.user===A&&call.name==='community_feed').length;
    await a.page.bringToFront();await a.page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));});await a.page.waitForTimeout(1200);
    const after=calls.filter(call=>call.user===A&&call.name==='community_feed').length;
    assert.ok(after>before,`Tab return ${i+1} refetches`);
    await a.page.getByRole('heading',{name:'Long security line at Terminal 4'}).waitFor();
    await a.page.getByRole('button',{name:/View 1 replies/}).click();await a.page.getByText('Terminal 2 was quieter earlier.',{exact:true}).waitFor();
  }
  await mkdir('.artifacts',{recursive:true});
  for(const width of [1440,390]){await c.page.setViewportSize({width,height:950});await c.page.evaluate(()=>window.scrollTo(0,0));assert.ok(await c.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Detail fits ${width}`);await c.page.screenshot({path:`.artifacts/community-detail-${width}.png`,fullPage:true});}
  for(let i=0;i<24;i++)comments.push({id:id(),post_id:postId,user_id:B,parent_comment_id:null,content:'Pagination comment '+i,is_deleted:false,created_at:timestamp(),updated_at:timestamp()});
  await c.page.getByRole('button',{name:'Refresh post'}).click();await c.page.getByRole('button',{name:'Load More Comments'}).waitFor();assert.equal(await c.page.locator('section[aria-labelledby="commentsHeading"] > .comment').count(),20);
  await c.page.getByRole('button',{name:'Load More Comments'}).click();await c.page.waitForFunction(()=>document.querySelectorAll('section[aria-labelledby="commentsHeading"] > .comment').length===25);
  // Trip prefill only copies non-sensitive fields; foreign trips are refused.
  await a.page.goto(base+'/itinerary/'+tripId);await a.page.getByRole('link',{name:'Post to Community'}).click();
  assert.equal(await a.page.getByLabel('Origin Airport (optional)',{exact:true}).inputValue(),'JFK');
  assert.equal(await a.page.getByLabel('Description *',{exact:true}).inputValue(),'');
  assert.ok(!(await a.page.locator('body').innerText()).includes('PRIVATE'));
  await b.page.goto(base+'/community/new?trip='+tripId);await b.page.getByRole('alert').filter({hasText:'Only your own trips'}).waitFor();
  await a.page.goto(base+'/community/'+postId+'/edit');await a.page.getByLabel('Title *',{exact:true}).fill('Updated security report');await a.page.getByRole('button',{name:'Save Changes'}).click();await a.page.getByRole('heading',{name:'Updated security report'}).waitFor();
  await a.page.goto(base+'/community/my-posts');await a.page.getByRole('link',{name:'Updated security report',exact:true}).waitFor();
  for(let i=0;i<22;i++)posts.push({...posts[0],id:id(),user_id:B,title:'Additional post '+i,created_at:timestamp(),airport_code:i%2?'DEL':'JFK'});
  await a.page.goto(base+'/community');await a.page.getByRole('button',{name:'Load More',exact:true}).waitFor();assert.equal(await a.page.locator('article.post').count(),20);await a.page.getByRole('button',{name:'Load More',exact:true}).click();await a.page.waitForFunction(()=>document.querySelectorAll('article.post').length===23);
  await a.page.getByLabel('Search community').fill('Additional post 21');await a.page.getByRole('button',{name:'Search',exact:true}).click();await a.page.waitForFunction(()=>document.querySelectorAll('article.post').length===1);
  await a.page.getByText('Filters',{exact:true}).click();await a.page.getByLabel('Airport',{exact:true}).fill('JFK');await a.page.getByRole('button',{name:'Apply filters'}).click();await a.page.getByText('No community posts yet. Start a conversation with other travelers.',{exact:true}).waitFor();
  await a.page.getByRole('button',{name:'Clear',exact:true}).click();await a.page.getByRole('button',{name:'Load More',exact:true}).waitFor();
  failFeed=true;await a.page.getByRole('button',{name:'Refresh community'}).click();await a.page.getByRole('alert').waitFor();failFeed=false;await a.page.getByRole('button',{name:'Retry',exact:true}).click();await a.page.getByRole('button',{name:'Load More',exact:true}).waitFor();
  posts[posts.length-1].title='LongTitleWithoutSpaces'.repeat(15);posts[posts.length-1].content='LongCommentWithoutSpaces'.repeat(30);await a.page.getByRole('button',{name:'Refresh community'}).click();await a.page.waitForTimeout(400);
  for(const width of [1440,390]){await a.page.setViewportSize({width,height:950});await a.page.evaluate(()=>window.scrollTo(0,0));assert.ok(await a.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Feed fits ${width}`);await a.page.screenshot({path:`.artifacts/community-feed-${width}.png`,fullPage:true});}
  await a.page.goto(base+'/community/'+postId);await a.page.getByRole('button',{name:'Share post'}).click();await a.page.waitForFunction(()=>document.body.innerText.includes('Post link copied.')||!!document.querySelector('input[aria-label="Post share link"]'));
  await a.page.getByRole('button',{name:'Delete post',exact:true}).click();await a.page.waitForURL('**/community');assert.ok(!posts.some(p=>p.id===postId));
  await a.page.goto(base+'/my-trips');await a.page.getByRole('link',{name:'View',exact:true}).first().waitFor();
  await a.page.goto(base+'/search');await a.page.getByRole('heading',{name:'Search Trips'}).waitFor();
  await a.page.goto(base+'/requests');await a.page.getByRole('button',{name:'Refresh',exact:true}).waitFor();
  await a.page.goto(base+'/messages');await a.page.getByRole('heading',{name:/Messages/}).waitFor();
  if(!await a.page.getByRole('button',{name:'Logout',exact:true}).isVisible())await a.page.getByRole('button',{name:'More',exact:true}).click();
  await a.page.getByRole('button',{name:'Logout',exact:true}).click();await a.page.waitForURL('**/auth**');
  const guest=await browser.newContext();await guest.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());const guestPage=await guest.newPage();await guestPage.goto(base+'/community');await guestPage.waitForURL('**/auth**');
  assert.deepEqual(errors,[]);console.log('PASS: A/B/C post CRUD, comments/replies, reactions, reporting, trip prefill privacy, pagination/search/filters, responsive layout, five simulated visibility/focus returns, existing page navigation and guest guard.');
}finally{await browser.close();}
