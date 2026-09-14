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
    const friendSocket=client(base,{extraHeaders:{Cookie:b.cookie},reconnection:false});sockets.push(friendSocket);
    await waitEvent(friendSocket,'connect');
    const friendReceived=waitEvent(friendSocket,'friend-request-received');
    assert.equal((await call('/friends/request','POST',{userId:b.data.user.id},a2.cookie)).status,200);
    const friendRequest=await friendReceived;
    assert.equal(friendRequest.requester,a.data.user.id);
    assert.equal(friendRequest.username,'alice');
    assert.equal((await call('/friends/requests','GET',{},b.cookie)).data[0].id.toString(),friendRequest.id);
    assert.deepEqual((await call('/friends/requests','GET',{},a2.cookie)).data,[]);
    assert.equal((await call('/friends/respond','POST',{id:a.data.user.id,requestId:'0',status:'accepted'},b.cookie)).status,404);
    const friendResolved=waitEvent(friendSocket,'friend-request-resolved');
    assert.equal((await call('/friends/respond','POST',{id:a.data.user.id,requestId:friendRequest.id,status:'accepted'},b.cookie)).status,200);
    assert.equal((await friendResolved).id,friendRequest.id);
    assert.deepEqual((await call('/friends/requests','GET',{},b.cookie)).data,[]);
    assert.equal((await call('/friends/respond','POST',{id:a.data.user.id,requestId:friendRequest.id,status:'declined'},b.cookie)).status,404);
    friendSocket.disconnect();
    const status=await call('/statuses','POST',{body:'Friends only'},a2.cookie);
    const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=';
    const media=await call('/statuses','POST',{image:png,link:'https://youtu.be/abcdefghijk'},a2.cookie);
    assert.equal(media.status,201);
    assert.equal((await call('/statuses','POST',{link:'javascript:alert(1)'},a2.cookie)).status,400);
    assert.equal((await fetch(base+`/api/statuses/${media.data.id}/image`,{headers:{cookie:b.cookie}})).status,200);
    assert.equal((await fetch(base+`/api/statuses/${media.data.id}/image`)).status,401);
    assert.equal((await call(`/statuses/${media.data.id}/repost`,'POST',{},b.cookie)).data.reposted,true);
    assert.equal((await call(`/statuses/${media.data.id}/like`,'POST',{},b.cookie)).data.liked,true);
    assert.equal((await call('/feed?filter=reposts','GET',{},b.cookie)).data[0].id,media.data.id);
    const liked=await call('/feed?filter=likes','GET',{},b.cookie);
    assert.equal(liked.data[0].has_image,true);assert.equal(liked.data[0].image_data,undefined);
    assert.equal((await call(`/statuses/${status.data.id}/replies`,'POST',{body:'hello'},b.cookie)).status,200);
    const aNotice=client(base,{extraHeaders:{Cookie:a2.cookie},reconnection:false});
    const bNotice=client(base,{extraHeaders:{Cookie:b.cookie},reconnection:false});
    sockets.push(aNotice,bNotice);
    await Promise.all([waitEvent(aNotice,'connect'),waitEvent(bNotice,'connect')]);
    const receivedChallenge=waitEvent(bNotice,'challenge-received');
    const challenge=await call('/challenges','POST',{userId:b.data.user.id},a2.cookie);
    const notification=await receivedChallenge;
    assert.equal(notification.id,challenge.data.id);assert.equal(notification.challenger,'alice');
    assert.ok(Date.parse(notification.expires_at)>Date.now());
    assert.equal((await call('/challenges','GET',{},b.cookie)).data[0].id,challenge.data.id);
    const acceptedChallenge=await call('/challenges','POST',{userId:b.data.user.id},a2.cookie);
    const opened=waitEvent(aNotice,'challenge-accepted'),resolved=waitEvent(bNotice,'challenge-resolved');
    const accepted=await call(`/challenges/${acceptedChallenge.data.id}/respond`,'POST',{status:'accepted'},b.cookie);
    assert.equal(accepted.status,200);
    assert.equal((await opened).gameId,accepted.data.gameId);
    assert.equal((await resolved).id,acceptedChallenge.data.id);
    assert.equal((await call(`/challenges/${acceptedChallenge.data.id}/respond`,'POST',{status:'accepted'},b.cookie)).status,404);
    const declinedChallenge=await call('/challenges','POST',{userId:b.data.user.id},a2.cookie);
    const declinedNotice=waitEvent(bNotice,'challenge-resolved');
    assert.equal((await call(`/challenges/${declinedChallenge.data.id}/respond`,'POST',{status:'declined'},b.cookie)).status,200);
    assert.equal((await declinedNotice).id,declinedChallenge.data.id);
    await call('/friends/block','POST',{userId:b.data.user.id},a2.cookie);
    assert.equal((await fetch(base+`/api/statuses/${media.data.id}/image`,{headers:{cookie:b.cookie}})).status,404);
    assert.equal((await call(`/statuses/${media.data.id}/repost`,'POST',{},b.cookie)).status,404);
    assert.deepEqual((await call('/feed?filter=reposts','GET',{},b.cookie)).data,[]);
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

    // Administration is server-authorized; blocking invalidates HTTP and live sockets.
    const adminLogin=await login('alice','final password 123');
    assert.equal((await call('/admin/users','GET',{},adminLogin.cookie)).status,403);
    process.env.ADMIN_USER_IDS=a.data.user.id;
    assert.equal((await call('/me','GET',{},adminLogin.cookie)).data.isAdmin,true);
    assert.equal((await call('/admin/users')).status,401);
    assert.equal((await call('/admin/users','GET',{},b.cookie)).status,403);
    const listing=await call('/admin/users?q=bob','GET',{},adminLogin.cookie);
    assert.equal(listing.data.users.length,1);
    assert.equal(listing.data.users[0].password_hash,undefined);
    const moderate=(id,action,extra={})=>call(`/admin/users/${id}/moderate`,'POST',{action,password:'final password 123',...extra},adminLogin.cookie);
    assert.equal((await moderate(a.data.user.id,'delete',{username:'alice'})).status,403);
    assert.equal((await moderate(b.data.user.id,'block',{password:'wrong'})).status,403);
    assert.equal((await call(`/admin/users/${a.data.user.id}/moderate`,'POST',{action:'delete',password:'valid password 123',username:'alice'},b.cookie)).status,403);
    const active=await call('/games','POST',{},b.cookie);
    const bs=client(base,{extraHeaders:{Cookie:b.cookie},reconnection:false});sockets.push(bs);await waitEvent(bs,'connect');
    const bsClosed=waitEvent(bs,'disconnect');
    assert.equal((await moderate(b.data.user.id,'block')).status,200);await bsClosed;
    assert.equal((await login('bobby')).status,403);
    assert.equal((await call('/me','GET',{},b.cookie)).status,401);
    assert.equal((await call('/games','POST',{},b.cookie)).status,401);
    assert.equal((await call(`/games/${active.data.id}`,'GET',{},adminLogin.cookie)).status,404);
    assert.equal((await moderate(b.data.user.id,'unblock')).status,200);
    assert.equal((await call('/me','GET',{},b.cookie)).status,401);
    const unblocked=await login('bobby');assert.equal(unblocked.status,200);
    await call('/statuses','POST',{body:'Delete with account'},unblocked.cookie);
    assert.equal((await moderate(b.data.user.id,'delete',{username:'wrong'})).status,404);
    assert.equal((await moderate(b.data.user.id,'delete',{username:'bobby'})).status,200);
    assert.equal((await call('/me','GET',{},unblocked.cookie)).status,401);
    assert.equal((await db.query('SELECT id FROM statuses WHERE user_id=$1',[b.data.user.id])).rows.length,0);
    assert.equal((await db.query('SELECT id FROM friendships WHERE requester=$1 OR addressee=$1',[b.data.user.id])).rows.length,0);
    delete process.env.ADMIN_USER_IDS;
  } finally {
    sockets.forEach(s=>s.disconnect());
    if(io)await new Promise(resolve=>io.close(resolve));
    pg.Pool=OriginalPool;await db.close();
  }
});
