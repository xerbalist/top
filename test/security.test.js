import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cookies, createSessions, isMember, Limiter, validPassword } from '../lib/security.js';

test('membership rejects absent identities and accepts only participants',()=>{
  const g={players:{w:'alice',b:null}};
  for(const id of [null,undefined,'','bob'])assert.equal(isMember(g,id),false);
  assert.equal(isMember(g,'alice'),true);
});
test('password byte limits, malformed cookies, bounded limiter',()=>{
  assert.equal(validPassword('short'),false);
  assert.equal(validPassword('a'.repeat(12)),true);
  assert.equal(validPassword('š'.repeat(40)),false);
  assert.equal(cookies('bad=%QQ; ok=yes').ok,'yes');
  const limit=new Limiter(1);
  assert.equal(limit.take('one',1),true);
  assert.equal(limit.take('one',1),false);
  assert.equal(limit.take('two',1),false);
});
test('sessions authenticate guests and revoke registered sessions',async()=>{
  const rows=new Map();const disconnected=[];
  const sessions=createSessions({secret:'a'.repeat(48),disconnect:room=>disconnected.push(room),query:async(sql,p)=>{
    if(sql.startsWith('INSERT')){rows.set(p[0],p[1]);return {rows:[{id:p[0]}]};}
    if(sql.startsWith('SELECT'))return {rows:rows.get(p[0])===p[1]?[{id:p[1],username:'Alice'}]:[]};
    if(sql.startsWith('DELETE FROM sessions WHERE id'))rows.delete(p[0]);
    if(sql.startsWith('DELETE FROM sessions WHERE user_id'))for(const [id,user] of rows)if(user===p[0])rows.delete(id);
    return {rows:[]};
  }});
  const guest=sessions.guest();assert.equal((await sessions.read(guest)).kind,'guest');
  assert.equal(await sessions.read(guest+'x'),null);
  assert.equal(await sessions.read('anon:alice'),null);
  const token=await sessions.issue({id:'alice',username:'Alice'});
  const second=await sessions.issue({id:'alice',username:'Alice'});
  await sessions.revoke(await sessions.read(token));
  assert.equal(await sessions.read(token),null);assert.ok(await sessions.read(second));
  await sessions.revoke(await sessions.read(second),true);
  assert.equal(await sessions.read(second),null);assert.equal(disconnected.length,2);
});

test('HTTP regression: spoofing, unauthenticated resign, private state, CSRF and legal moves',async()=>{
  const child=spawn(process.execPath,['server.js'],{env:{...process.env,NODE_ENV:'development',PORT:'0',PUBLIC_URL:'http://localhost:8080',DATABASE_URL:'',PGHOST:''},stdio:['ignore','pipe','pipe']});
  try {
    const port=await new Promise((resolve,reject)=>{
      let out='';const timer=setTimeout(()=>reject(new Error('startup timeout')),10000);
      child.stdout.on('data',b=>{out+=b;const m=out.match(/portu (\d+)/);if(m){clearTimeout(timer);resolve(m[1]);}});
      child.once('exit',()=>{clearTimeout(timer);reject(new Error('server exited'));});
    });
    const base=`http://127.0.0.1:${port}/api`;
    const post=(route,cookie='',body={},extra={})=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-Top-Request':'1',...(cookie?{cookie}:{}),...extra},body:JSON.stringify(body)});
    const first=await post('/games'); const alice=first.headers.get('set-cookie').split(';')[0];const game=await first.json();
    assert.ok(alice.includes('top_session='));
    assert.equal((await post(`/games/${game.id}/resign`)).status,403);
    assert.equal((await post(`/games/${game.id}/resign`,'',{}, {'X-Player-Id':game.playerId})).status,403);
    assert.equal((await fetch(base+`/games/${game.id}`)).status,403);
    assert.equal((await post('/games',alice,{}, {Origin:'https://evil.example'})).status,403);
    assert.equal((await post('/games',alice,{}, {'X-Top-Request':''})).status,403);
    const joined=await post(`/games/${game.id}/join`);const bob=joined.headers.get('set-cookie').split(';')[0];
    assert.equal(joined.status,200);
    assert.equal((await post(`/games/${game.id}/move`,alice,{move:{from:'e2',to:'e4'}})).status,200);
    assert.equal((await post(`/games/${game.id}/move`,alice,{move:{from:'e7',to:'e5'}})).status,403);
    assert.equal((await post(`/games/${game.id}/move`,bob,{move:{from:'e7',to:'e5'}})).status,200);
    assert.equal((await post(`/games/${game.id}/resign`,alice)).status,200);
    assert.equal((await post('/auth/recover','',{password:'x'})).status,400);
  } finally {child.kill();await once(child,'exit');}
});
