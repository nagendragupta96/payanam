import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../020_travel_community.sql', import.meta.url), 'utf8');
const A='10000000-0000-0000-0000-000000000001', B='10000000-0000-0000-0000-000000000002', C='10000000-0000-0000-0000-000000000003';
async function fixture(){
  const db=new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated;
    create table auth.users(id uuid primary key);
    create table public.profiles(id uuid primary key references auth.users(id) on delete cascade,display_name text,avatar_url text,private_contact text);
    alter table public.profiles enable row level security;
    create policy own_profile on public.profiles for select to authenticated using(id=auth.uid());
    grant select on public.profiles to authenticated;
    insert into auth.users values('${A}'),('${B}'),('${C}');
    insert into public.profiles values('${A}','Traveler A',null,'SECRET A'),('${B}','Traveler B',null,'SECRET B'),('${C}','Traveler C',null,'SECRET C');
    create function public.is_app_admin() returns boolean language sql as $$ select false $$;
    create function public.audit_app_change() returns trigger language plpgsql as $$ begin if tg_op='DELETE' then return old; end if; return new; end $$;`);
  await db.exec(migration);return db;
}
async function user(db,id,role='authenticated'){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.exec(`set role ${role}`);}
async function post(db,title='JFK security update'){return (await db.query("insert into public.community_posts(category,title,content,airport_code,origin_airport,destination_airport,flight_number,travel_date) values('Airport Update',$1,'Security line at Terminal 4','JFK','JFK','DEL','AI102','2099-12-01') returning *",[title])).rows[0];}
async function comment(db,p,body='Test comment',parent=null){return (await db.query('insert into public.community_comments(post_id,content,parent_comment_id) values($1,$2,$3) returning *',[p,body,parent])).rows[0];}
async function feed(db,params=[]){return (await db.query('select public.community_feed('+params.map((_,i)=>'$'+(i+1)).join(',')+') result',params)).rows[0].result;}
async function toggle(db,p,c,type){await db.query('select public.community_toggle_reaction($1,$2,$3)',[p,c,type]);}

test('A/B/C ownership and direct RLS prevent impersonation and editing other users',async()=>{
  const db=await fixture();try{
    await db.exec(migration);await user(db,A);const p=await post(db);
    await user(db,B);const c=await comment(db,p.id);await toggle(db,p.id,null,'like');
    assert.equal((await db.query('update public.community_posts set title=$1 where id=$2 returning id',['forged',p.id])).rows.length,0);
    assert.equal((await db.query('delete from public.community_posts where id=$1 returning id',[p.id])).rows.length,0);
    await assert.rejects(db.query("insert into public.community_posts(user_id,category,title,content) values($1,'Other','Impersonation','No')",[A]),/row-level security/);
    await assert.rejects(db.query('update public.community_comments set user_id=$1 where id=$2',[A,c.id]),/permission denied/);
    await user(db,A);
    assert.equal((await db.query('update public.community_comments set content=$1 where id=$2 returning id',['tampered',c.id])).rows.length,0);
    assert.equal((await db.query('delete from public.community_comments where id=$1 returning id',[c.id])).rows.length,0);
    await user(db,C);const reply=await comment(db,p.id,'Reply from C',c.id);await toggle(db,null,c.id,'thanks');
    assert.equal(reply.user_id,C);
    assert.equal((await db.query('delete from public.community_reactions where user_id=$1 returning id',[B])).rows.length,0);
    assert.equal((await db.query("update public.community_reactions set reaction_type='support' where user_id=$1 returning id",[B])).rows.length,0);
    await assert.rejects(db.query("insert into public.community_reactions(user_id,post_id,reaction_type) values($1,$2,'like')",[B,p.id]),/row-level security/);
    await assert.rejects(db.query('insert into public.community_comments(user_id,post_id,content) values($1,$2,$3)',[B,p.id,'Fake']),/row-level security/);
    await user(db,null,'anon');
    for(const sql of ['select * from public.community_posts','select * from public.community_comments','select * from public.community_reactions','select * from public.community_reports','select public.community_feed()']) await assert.rejects(db.exec(sql),/permission denied/);
    await assert.rejects(post(db),/permission denied/);await assert.rejects(comment(db,p.id),/permission denied/);await assert.rejects(toggle(db,p.id,null,'like'),/permission denied/);
  }finally{await db.close();}
});

test('reply depth, same-post constraint, deleted comment preservation and validation',async()=>{
  const db=await fixture();try{
    await user(db,A);const p=await post(db),other=await post(db,'Other trip');const root=await comment(db,p.id);
    await user(db,B);const reply=await comment(db,p.id,'Reply',root.id);
    await assert.rejects(comment(db,p.id,'Too deep',reply.id),/top-level/);
    await assert.rejects(comment(db,other.id,'Wrong post',root.id),/same post/);
    await assert.rejects(comment(db,p.id,' '),/check constraint/);
    await assert.rejects(post(db,'x'.repeat(161)),/check constraint/);
    await assert.rejects(db.query("insert into public.community_posts(category,title,content,airport_code) values('Other','Trip','test','INVALID')"),/check constraint/);
    await assert.rejects(db.query('update public.community_comments set parent_comment_id=null where id=$1',[reply.id]),/permission denied/);
    await user(db,A);await db.query('update public.community_comments set is_deleted=true where id=$1',[root.id]);
    assert.equal((await db.query('select content from public.community_comments where id=$1',[root.id])).rows[0].content,'[Comment deleted]');
    assert.equal((await db.query('select id from public.community_comments where id=$1',[reply.id])).rows.length,1);
    await assert.rejects(db.query("update public.community_comments set content='restored' where id=$1",[root.id]),/Deleted comments/);
    await db.query('delete from public.community_comments where id=$1',[root.id]);
    assert.equal((await db.query('select parent_comment_id from public.community_comments where id=$1',[reply.id])).rows[0].parent_comment_id,null);
    await db.query('delete from public.community_posts where id=$1',[p.id]);
    assert.equal((await db.query('select * from public.community_comments where post_id=$1',[p.id])).rows.length,0);
  }finally{await db.close();}
});

test('reactions toggle/replace, enforce one target and cascade on deletion',async()=>{
  const db=await fixture();try{
    await user(db,A);const p=await post(db);const c=await comment(db,p.id);
    await user(db,B);await toggle(db,p.id,null,'like');await toggle(db,p.id,null,'support');
    let rows=(await db.query('select * from public.community_reactions')).rows;assert.equal(rows.length,1);assert.equal(rows[0].reaction_type,'support');
    await assert.rejects(db.query("insert into public.community_reactions(post_id,reaction_type) values($1,'thanks')",[p.id]),/unique constraint/);
    await toggle(db,p.id,null,'support');assert.equal((await db.query('select * from public.community_reactions')).rows.length,0);
    await toggle(db,null,c.id,'helpful');await toggle(db,null,c.id,'like');
    await assert.rejects(toggle(db,p.id,c.id,'like'),/Invalid reaction/);
    await assert.rejects(toggle(db,p.id,null,'invalid'),/Invalid reaction/);
    await assert.rejects(db.exec("insert into public.community_reactions(reaction_type) values('like')"),/check constraint/);
    await user(db,A);await db.query('delete from public.community_posts where id=$1',[p.id]);
    assert.equal((await db.query('select * from public.community_reactions')).rows.length,0);
  }finally{await db.close();}
});

test('reports stay private and cannot auto-delete content or change moderation status',async()=>{
  const db=await fixture();try{
    await user(db,A);const p=await post(db);await user(db,B);
    const report=(await db.query("insert into public.community_reports(post_id,reason,details) values($1,'Spam','PRIVATE REPORT') returning *",[p.id])).rows[0];
    await assert.rejects(db.query("insert into public.community_reports(reporter_user_id,post_id,reason) values($1,$2,'Spam')",[A,p.id]),/row-level security/);
    await assert.rejects(db.query("insert into public.community_reports(post_id,reason,status) values($1,'Other','REVIEWED')",[p.id]),/permission denied/);
    assert.equal((await db.query("update public.community_reports set status='DISMISSED' where id=$1 returning id",[report.id])).rows.length,0);
    await user(db,C);assert.equal((await db.query('select * from public.community_reports')).rows.length,0);
    await user(db,A);assert.equal((await db.query('select * from public.community_reports')).rows.length,0);
    assert.equal((await feed(db)).rows.length,1);assert.ok(!JSON.stringify(await feed(db)).includes('PRIVATE REPORT'));
  }finally{await db.close();}
});

test('feed filters, safe search, current profiles, bounded pagination and most-discussed sort',async()=>{
  const db=await fixture();try{
    await user(db,A);const popular=await post(db,'Popular airport update');
    for(let i=0;i<23;i++)await post(db,'Travel tip '+i);
    await user(db,B);for(let i=0;i<25;i++)await comment(db,popular.id,'Comment '+i);
    await toggle(db,popular.id,null,'helpful');
    const page=await feed(db);assert.equal(page.rows.length,20);assert.equal(page.has_more,true);
    assert.equal(page.rows[0].display_name,'Traveler A');assert.ok(!JSON.stringify(page).includes('SECRET'));
    const second=await feed(db,['','','','','',null,'latest',false,20]);assert.equal(second.rows.length,4);assert.equal(second.has_more,false);
    assert.ok(!second.rows.some(p=>page.rows.some(first=>first.id===p.id)));
    assert.equal((await feed(db,['','','','','',null,'discussed'])).rows[0].id,popular.id);
    assert.equal((await feed(db,['AI102','JFK','Airport Update','JFK','DEL','2099-12-01'])).rows.length,20);
    assert.equal((await feed(db,['','LHR'])).rows.length,0);
    assert.equal((await feed(db,["' OR true --"])).rows.length,0);
    assert.equal((await feed(db,['','','','','',null,'latest',true])).rows.length,0);
    const comments=(await db.query('select public.community_comment_page($1) result',[popular.id])).rows[0].result;
    assert.equal(comments.rows.length,20);assert.equal(comments.has_more,true);
    assert.equal((await db.query('select public.community_comment_page($1,null,20) result',[popular.id])).rows[0].result.rows.length,5);
    await db.exec('reset role');await db.query("update public.profiles set display_name='Updated traveler' where id=$1",[A]);
    await user(db,B);assert.equal((await feed(db)).rows[0].display_name,'Updated traveler');
    await assert.rejects(feed(db,['','','','','',null,'invalid']),/Invalid feed/);
    await user(db,null);await assert.rejects(feed(db),/Sign in required/);
  }finally{await db.close();}
});
