import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { io as client } from 'socket.io-client';
import { EncryptedChat } from '../public/chat-crypto.js';

const waitEvent=(socket,name)=>new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{socket.off(name,done);reject(new Error('Timed out: '+name));},5000);
  function done(value){clearTimeout(timeout);resolve(value);}
  socket.once(name,done);
});
test('PostgreSQL integration: sessions, recovery, blocks, social authorization and encrypted socket relay', {timeout:30000}, async()=>{
  const db=new PGlite();
  const OriginalPool=pg.Pool;
  pg.Pool=class {
    async query(sql,params){
      if(sql.includes('CREATE EXTENSION')) {await db.exec(sql.replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',''));return {rows:[]};}
      return db.query(sql,params);
    }
  };
  Object.assign(process.env,{NODE_ENV:'development',PORT:'0',PUBLIC_URL:'http://localhost:8080',DATABASE_URL:'',PGHOST:'in-process-test',JWT_SECRET:'s'.repeat(48),MNEMONIC_PEPPER:'p'.repeat(48),ANONYMOUS_SECRET_MOVES:JSON.stringify({w:[{from:'g1',to:'f3'},{from:'f3',to:'g1'},{from:'b1',to:'c3'},{from:'c3',to:'b1'},{from:'g1',to:'f3'}],b:[]})});
  let server,io;const sockets=[];
  try {
    ({server,io}=await import('../server.js'));
    if(!server.listening)await new Promise(resolve=>server.once('listening',resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    const call=async(route,method='GET',body={},cookie='')=>{
      const response=await fetch(base+'/api'+route,{method,headers:{'Content-Type':'application/json','X-Top-Request':'1',...(cookie?{cookie}:{})},...(method==='GET'?{}:{body:JSON.stringify(body)})});
      return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
    };
    const login=(username,password='valid password 123')=>call('/auth/login','POST',{username,password});
    const a=await call('/auth/register','POST',{username:'alice',password:'valid password 123'});
    const b=await call('/auth/register','POST',{username:'bobby',password:'valid password 123'});
    assert.equal(a.status,201);assert.equal(b.status,201);
    assert.equal(a.data.mnemonic.split(' ').length,18);
    const a2=await login('alice');
    const sock=client(base,{extraHeaders:{Cookie:a.cookie},reconnection:false});sockets.push(sock);await waitEvent(sock,'connect');
    const closed=waitEvent(sock,'disconnect');
    assert.equal((await call('/auth/logout','POST',{},a.cookie)).status,200);await closed;
    assert.equal((await call('/me','GET',{},a.cookie)).status,401);
    assert.equal((await call('/me','GET',{},a2.cookie)).status,200);
    await call('/friends/request','POST',{userId:b.data.user.id},a2.cookie);
    await call('/friends/respond','POST',{id:a.data.user.id,status:'accepted'},b.cookie);
    const status=await call('/statuses','POST',{body:'Friends only'},a2.cookie);
    assert.equal((await call(`/statuses/${status.data.id}/replies`,'POST',{body:'hello'},b.cookie)).status,200);
    const challenge=await call('/challenges','POST',{userId:b.data.user.id},a2.cookie);
    await call('/friends/block','POST',{userId:b.data.user.id},a2.cookie);
    await call(`/friends/${a.data.user.id}`,'DELETE',{},b.cookie);
    assert.equal((await call('/friends/request','POST',{userId:a.data.user.id},b.cookie)).status,403);
    assert.equal((await call(`/statuses/${status.data.id}/replies`,'GET',{},b.cookie)).status,404);
    assert.equal((await call(`/challenges/${challenge.data.id}/respond`,'POST',{status:'accepted'},b.cookie)).status,404);
    assert.equal((await call('/auth/recover','POST',{username:'alice',mnemonic:a.data.mnemonic,password:'short'})).status,400);
    assert.equal((await call('/auth/recover','POST',{username:'alice',mnemonic:a.data.mnemonic,password:'replacement password 123'})).status,200);
    assert.equal((await call('/me','GET',{},a2.cookie)).status,401);
    const recovered=await login('alice','replacement password 123');assert.equal(recovered.status,200);
    assert.equal((await call('/auth/change-password','POST',{currentPassword:'replacement password 123',newPassword:'final password 123'},recovered.cookie)).status,200);
    assert.equal((await call('/me','GET',{},recovered.cookie)).status,401);

    const g=await call('/games','POST');const id=g.data.id;
    const peer=await call(`/games/${id}/join`,'POST');
    const wa=client(base,{extraHeaders:{Cookie:g.cookie},reconnection:false}),wb=client(base,{extraHeaders:{Cookie:peer.cookie},reconnection:false});sockets.push(wa,wb);
    await Promise.all([waitEvent(wa,'connect'),waitEvent(wb,'connect')]);
    wa.emit('join-game',id);wb.emit('join-game',id);
    const white=['g1f3','f3g1','b1c3','c3b1','g1f3'],black=['a7a6','a6a5','h7h6','h6h5'];
    for(let i=0;i<5;i++){
      assert.equal((await call(`/games/${id}/move`,'POST',{move:{from:white[i].slice(0,2),to:white[i].slice(2)}},g.cookie)).status,200);
      if(i<4)assert.equal((await call(`/games/${id}/move`,'POST',{move:{from:black[i].slice(0,2),to:black[i].slice(2)}},peer.cookie)).status,200);
    }
    assert.equal((await call(`/games/${id}`,'GET',{},g.cookie)).data.chatUnlocked,true);
    const ca=new EncryptedChat(id,g.data.playerId,peer.data.playerId),cb=new EncryptedChat(id,peer.data.playerId,g.data.playerId);
    await Promise.all([ca.init(),cb.init()]);
    const receivedA=waitEvent(wa,'chat-key'), receivedB=waitEvent(wb,'chat-key');
    wa.emit('chat-key',{gameId:id,publicKey:ca.publicKey});wb.emit('chat-key',{gameId:id,publicKey:cb.publicKey});
    const [ka,kb]=await Promise.all([receivedA,receivedB]);
    await ca.acceptPeer(ka.publicKey);await cb.acceptPeer(kb.publicKey);assert.equal(ca.fingerprint,cb.fingerprint);ca.confirm();cb.confirm();
    const encrypted=await ca.encrypt('privatna poruka');const received=waitEvent(wb,'chat-message');
    wa.emit('chat-message',{gameId:id,envelope:encrypted,text:'must never be relayed'});
    const message=await received;assert.equal(message.text,undefined);assert.equal(await cb.decrypt(message.envelope,message.playerId),'privatna poruka');
    assert.equal(message.sender,'Anonimni igrač');
    // Malformed events must not terminate the process or expose another game.
    wa.emit('chat-message',null);wa.emit('join-game',{});
    assert.equal((await call(`/games/${id}/resign`,'POST',{},g.cookie)).status,200);
    assert.equal((await call(`/games/${id}`,'GET',{},peer.cookie)).data.chatUnlocked,false);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE '%chat%'")).rows[0].n,0);
  } finally {
    sockets.forEach(s=>s.disconnect());
    if(io)await new Promise(resolve=>io.close(resolve));
    pg.Pool=OriginalPool;await db.close();
  }
});
