import express from 'express';
import http from 'http';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { cookies, createSessions, isMember, Limiter, validPassword } from './lib/security.js';
import { Server } from 'socket.io';
import { Chess } from 'chess.js';
import pg from 'pg';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { advanceSequence, moveForColor, validatePersonalSequence } from './lib/move-sequence.js';
import { botMove } from './lib/bot-pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express(); const server = http.createServer(app);
const publicOrigin = new URL(process.env.PUBLIC_URL || 'http://localhost:8080').origin;
const allowedOrigin = origin => !origin || origin === publicOrigin;
const io = new Server(server, { maxHttpBufferSize:8192, allowRequest:(req,done)=>done(null,allowedOrigin(req.headers.origin)) });
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));
app.disable('x-powered-by');
// Catch every async route/middleware rejection under Express 4.
for (const method of ['get','post','put','patch','delete','use']) {
  const original = app[method].bind(app);
  app[method] = (...args) => original(...args.map(handler => typeof handler === 'function' && handler.constructor.name === 'AsyncFunction'
    ? (req,res,next) => Promise.resolve(handler(req,res,next)).catch(next) : handler));
}
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(48).toString('hex');
const PEPPER = process.env.MNEMONIC_PEPPER || crypto.randomBytes(48).toString('hex');
const anonymousSecret = (()=>{ try { const parsed=JSON.parse(process.env.ANONYMOUS_SECRET_MOVES||'{}'); const normalize=list=>Array.isArray(list)&&list.length===5?list.map(m=>({from:m.from,to:m.to,promotion:m.promotion||null})):[]; return {w:normalize(parsed.w),b:normalize(parsed.b)}; } catch { return {w:[],b:[]}; } })();
const { Pool } = pg;
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : process.env.PGHOST
    ? new Pool({
        host:process.env.PGHOST,
        port:Number(process.env.PGPORT||5432),
        database:process.env.PGDATABASE,
        user:process.env.PGUSER,
        password:process.env.PGPASSWORD
      })
    : null;
const games = new Map();
const limiter = new Limiter();
const words = [...new Set(`
  sova golub motika jabuka reka prozor kamen trava sunce put nebo livada vatra most cvet sat
  torba knjiga oblak vetar selo more brdo zvezda list orah med hleb voda vrata bicikl stanica
  telefon olovka jastuk lopta krug drvo zmaj konj vuk ris jelen srna lasta roda vrabac pas zec
  gavran slavuj fazan patka guska labud kuna vidra dabar lisica medved panda lama koala zebra
  antilopa gazela kamila leopard tigar lav slon bizon ovan koza krava bik tele pile petao som
  tuna pastrmka sardina rak mrav osa buba moljac pauk planeta kometa meteor mesec rosa oluja
  magla led sneg izvor potok bara jezero zaliv ostrvo polje dolina ravnica stena pesak zemlja
  glina bor jela breza lipa bukva hrast bagrem topola vrba loza malina kupina jagoda breskva
  kajsija lubenica dinja limun nar dud smokva grozd pasulj kukuruz ovas proso lan mak sever jug
  istok zapad obala luka brod jedro veslo sidro talas pena biser koral papir pero mastilo okvir
  ogledalo kanta korpa konopac lanac ekser alat plug krevet orman tepih lampa radio ekran album
  paket motor tunel balkon podrum krov zid
`.trim().split(/\s+/))];
if (words.some(word => !/^[a-z]+$/.test(word))) throw new Error('Mnemonic rečnik sadrži nedozvoljenu reč.');
app.use((req,res,next)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security','max-age=31536000');
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control','no-store');
    if (!limiter.take('http:'+req.ip,180)) return res.status(429).json({error:'Previše zahteva. Pokušaj kasnije.'});
    if (!['GET','HEAD','OPTIONS'].includes(req.method) && (!allowedOrigin(req.headers.origin) || req.headers['x-top-request'] !== '1' || !req.is('application/json'))) return res.status(403).json({error:'Zahtev nije dozvoljen.'});
  }
  next();
});
app.use(express.json({ limit: '320kb' }));
app.use('/api/auth', (req,res,next)=>{
  if (['/logout','/logout-all'].includes(req.path)) return next();
  if (req.method !== 'GET' && !limiter.take('auth-ip:'+req.ip,20,15*60000)) return res.status(429).json({error:'Previše pokušaja. Sačekaj 15 minuta.'});
  const username = typeof req.body?.username === 'string' ? req.body.username.toLowerCase().slice(0,24) : '';
  if (username && !limiter.take('auth-name:'+username,20,15*60000)) return res.status(429).json({error:'Previše pokušaja. Sačekaj 15 minuta.'});
  next();
});
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders:(res,filePath)=>{
    if (/\.(?:html|js|css)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    }
  }
}));
const sessions = createSessions({secret:JWT_SECRET,query:(...args)=>q(...args),disconnect:room=>io.in(room).disconnectSockets(true)});
const requestToken = req => (req.headers.authorization||'').replace(/^Bearer /,'') || cookies(req.headers.cookie).top_session || '';
const sessionCookie = (token,maxAge=2592000,secure=false) => `top_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure || process.env.NODE_ENV==='production'?'; Secure':''}`;
const createToken = user => sessions.issue(user);
const auth = async (req,res,next)=>{
  const session = await sessions.read(requestToken(req));
  if (session?.kind !== 'user') {
    if (!session && requestToken(req)) res.setHeader('Set-Cookie',sessionCookie('',0,req.secure));
    return res.status(401).json({error:'Potrebna je prijava.'});
  }
  req.session=session; req.user=session; next();
};
const optionalAuth = async (req,res,next)=>{
  let session=await sessions.read(requestToken(req));
  if (!session) {
    const token=sessions.guest();
    session=await sessions.read(token);
    res.setHeader('Set-Cookie',sessionCookie(token,604800,req.secure));
  }
  req.session=session;
  if (session.kind==='user') req.user=session;
  else req.guestId=session.id;
  next();
};
const identity = req=>req.session?.id || null;
const playerName = req=>req.user?.username || 'Anonimni igrač';
const mnemonic = ()=>Array.from({length:18},()=>words[crypto.randomInt(words.length)]).join(' ');
const hashMnemonic = s=>crypto.createHash('sha256').update(`${s}|${PEPPER}`).digest('hex');
const normaliseSecretMoves = value => {
  if (Array.isArray(value)) {
    return { w:value, b:value.map(move => moveForColor(move, 'b')) };
  }
  return {
    w:Array.isArray(value?.w) ? value.w : [],
    b:Array.isArray(value?.b) ? value.b : []
  };
};
const q = async (text, values=[])=>{ if(!pool){const error=new Error('PostgreSQL nije podešen.');error.code='DB_NOT_CONFIGURED';throw error} return pool.query(text,values); };
const databaseUnavailable = error => !pool || error?.code==='DB_NOT_CONFIGURED' || error?.code==='ECONNREFUSED' || String(error?.code||'').startsWith('08');
const safeUser = r=>({id:r.id,username:r.username,avatar:r.avatar_data||'',bio:r.bio||'',country:r.country||'',createdAt:r.created_at});
const endReason = chess => {
  if (chess.isCheckmate()) return 'mat';
  if (chess.isStalemate()) return 'pat';
  if (chess.isThreefoldRepetition()) return 'trostruko ponavljanje';
  if (chess.isInsufficientMaterial()) return 'nedovoljno materijala';
  if (chess.isDraw()) return 'remi';
  return null;
};
const gameState = g => ({
  id:g.id,
  fen:g.chess.fen(),
  turn:g.chess.turn(),
  inCheck:Boolean(g.chess.inCheck()),
  history:g.chess.history(),
  lastMove:g.lastMove || null,
  legalMoves:g.ended||g.chess.isGameOver()?[]:g.chess.moves({verbose:true}).map(move=>({from:move.from,to:move.to,promotion:move.promotion||null})),
  players:g.players,
  playerNames:g.playerNames || {},
  bot:Boolean(g.bot),
  botName:g.bot?.name || null,
  botThinking:Boolean(g.botThinking),
  ready:Boolean(g.players.w&&g.players.b),
  chatUnlocked:Boolean(!g.bot&&g.unlocked&&!g.ended&&!g.chess.isGameOver()),
  gameOver:Boolean(g.ended||g.chess.isGameOver()),
  endReason:g.endReason||endReason(g.chess)
});

app.get('/api/health',async(req,res)=>{ if(!pool)return res.status(503).json({ok:false,name:'TOP',database:'not-configured'}); try { await pool.query('SELECT 1'); res.json({ok:true,name:'TOP',database:'connected',time:new Date().toISOString()}); } catch { res.status(503).json({ok:false,name:'TOP',database:'unavailable'}); } });
app.post('/api/auth/register',async(req,res)=>{ try { const username=String(req.body.username||'').trim(); const password=String(req.body.password||''); if(!/^[a-zA-Z0-9_]{3,24}$/.test(username)||!validPassword(password)) return res.status(400).json({error:'Korisničko ime mora imati 3–24 slova, broja ili _, a lozinka 12–72 UTF-8 bajta (najmanje 12 znakova).'}); const phrase=mnemonic(); const h=await bcrypt.hash(password,12); const r=await q('INSERT INTO users(username,password_hash,mnemonic_hash) VALUES($1,$2,$3) RETURNING *',[username,h,hashMnemonic(phrase)]); const u=safeUser(r.rows[0]); res.setHeader('Set-Cookie',sessionCookie(await createToken({...u,authVersion:r.rows[0].auth_version}),2592000,req.secure)); res.status(201).json({user:u,mnemonic:phrase}); } catch(e){ if(e.code==='23505')return res.status(409).json({error:'Korisničko ime već postoji.'}); if(databaseUnavailable(e))return res.status(503).json({error:'Registracija trenutno nije dostupna jer PostgreSQL baza nije povezana.'}); res.status(500).json({error:'Registracija nije uspela. Pokušaj ponovo.'}); }});
app.post('/api/auth/login',async(req,res)=>{ try { const r=await q('SELECT * FROM users WHERE lower(username)=lower($1)',[req.body.username]); if(!r.rows[0]||!(await bcrypt.compare(req.body.password||'',r.rows[0].password_hash))) return res.status(401).json({error:'Pogrešno korisničko ime ili lozinka.'}); const u=safeUser(r.rows[0]); res.setHeader('Set-Cookie',sessionCookie(await createToken({...u,authVersion:r.rows[0].auth_version}),2592000,req.secure)); res.json({user:u}); } catch(e) { res.status(databaseUnavailable(e)?503:500).json({error:'Baza nije dostupna.'}); }});
app.post('/api/auth/logout',async(req,res)=>{ const session=await sessions.read(requestToken(req)); await sessions.revoke(session); res.setHeader('Set-Cookie',sessionCookie('',0,req.secure)); res.json({ok:true}); });
app.post('/api/auth/recover',async(req,res)=>{ try { if(!validPassword(req.body.password))return res.status(400).json({error:'Lozinka mora imati najmanje 12 znakova i najviše 72 UTF-8 bajta.'}); const phrase=String(req.body.mnemonic||'').trim().toLowerCase().replace(/\s+/g,' '); if(!/^[a-z ]+$/.test(phrase)) return res.status(400).json({error:'Mnemonic fraza sme sadržati samo slova bez dijakritike.'}); const r=await q('SELECT * FROM users WHERE lower(username)=lower($1) AND mnemonic_hash=$2',[req.body.username,hashMnemonic(phrase)]); if(!r.rows[0]) return res.status(400).json({error:'Podaci za oporavak nisu ispravni.'}); await q('UPDATE users SET password_hash=$1,auth_version=auth_version+1 WHERE id=$2',[await bcrypt.hash(req.body.password,12),r.rows[0].id]); await sessions.revoke({kind:'user',id:r.rows[0].id},true); res.json({ok:true}); } catch { res.status(500).json({error:'Oporavak nije uspeo.'}); }});
app.post('/api/auth/change-password',auth,async(req,res)=>{ try { const current=String(req.body.currentPassword||''); const next=String(req.body.newPassword||''); if(!validPassword(next))return res.status(400).json({error:'Nova lozinka mora imati najmanje 12 znakova i najviše 72 UTF-8 bajta.'}); const r=await q('SELECT password_hash FROM users WHERE id=$1',[req.user.id]); if(!r.rows[0]||!(await bcrypt.compare(current,r.rows[0].password_hash)))return res.status(400).json({error:'Trenutna lozinka nije ispravna.'}); await q('UPDATE users SET password_hash=$1,auth_version=auth_version+1 WHERE id=$2',[await bcrypt.hash(next,12),req.user.id]); await sessions.revoke(req.session,true); res.setHeader('Set-Cookie',sessionCookie('',0,req.secure)); res.json({ok:true}); } catch { res.status(500).json({error:'Promena lozinke nije uspela.'}); }});
app.post('/api/auth/rotate-mnemonic',auth,async(req,res)=>{
  const r=await q('SELECT password_hash FROM users WHERE id=$1',[req.user.id]);
  if(typeof req.body.password!=='string'||!(await bcrypt.compare(req.body.password,r.rows[0].password_hash)))return res.status(403).json({error:'Lozinka nije ispravna.'});
  const phrase=mnemonic();
  await q('UPDATE users SET mnemonic_hash=$1 WHERE id=$2',[hashMnemonic(phrase),req.user.id]);
  res.json({mnemonic:phrase});
});
app.post('/api/auth/logout-all',auth,async(req,res)=>{await sessions.revoke(req.session,true);res.setHeader('Set-Cookie',sessionCookie('',0,req.secure));res.json({ok:true});});
app.get('/api/me',auth,async(req,res)=>{ const r=await q('SELECT id,username,avatar_data,bio,country,created_at FROM users WHERE id=$1',[req.user.id]); res.json(safeUser(r.rows[0])); });
app.patch('/api/profile',auth,async(req,res)=>{ try { const avatar=String(req.body.avatar||''); const bio=String(req.body.bio||'').trim(); const country=String(req.body.country||'').trim(); if(avatar.length>300000||avatar&&!/^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(avatar))return res.status(400).json({error:'Profilna slika nije ispravna ili je prevelika.'}); if(bio.length>280)return res.status(400).json({error:'Biografija može imati najviše 280 karaktera.'}); if(country.length>80)return res.status(400).json({error:'Naziv države je predugačak.'}); const r=await q('UPDATE users SET avatar_data=$1,bio=$2,country=$3 WHERE id=$4 RETURNING id,username,avatar_data,bio,country,created_at',[avatar,bio,country,req.user.id]); res.json(safeUser(r.rows[0])); } catch(e) { res.status(databaseUnavailable(e)?503:500).json({error:'Profil nije sačuvan.'}); }});
app.get('/api/profile/secret-moves',auth,async(req,res)=>{ const r=await q('SELECT secret_moves FROM users WHERE id=$1',[req.user.id]); res.json({moves:normaliseSecretMoves(r.rows[0]?.secret_moves)}); });
app.post('/api/profile/secret-moves/validate',auth,async(req,res)=>{ try { const moves=Array.isArray(req.body.moves)?req.body.moves:[]; const color=req.body.color==='b'?'b':'w'; const result=validatePersonalSequence(moves,5,color); res.json({valid:true,complete:moves.length===5,fen:result.fen,history:result.history,color}); } catch { res.status(400).json({valid:false,error:'Sekvenca sadrži nelegalan potez.'}); }});
app.put('/api/profile/secret-moves',auth,async(req,res)=>{ try { const moves=normaliseSecretMoves(req.body.moves); if(moves.w.length!==5||moves.b.length!==5) return res.status(400).json({error:'Unesi tačno pet legalnih poteza i za bele i za crne figure.'}); const result={w:validatePersonalSequence(moves.w,5,'w').history,b:validatePersonalSequence(moves.b,5,'b').history}; await q('UPDATE users SET secret_moves=$1 WHERE id=$2',[JSON.stringify(result),req.user.id]); res.json({ok:true,message:'Obe sekvence su sačuvane.'}); } catch { res.status(400).json({error:'Potezi nisu sačuvani. Proveri obe sekvence.'}); }});
app.get('/api/users/search',auth,async(req,res)=>{ const r=await q('SELECT id,username,created_at FROM users WHERE username ILIKE $1 AND id<>$2 LIMIT 20',[`${req.query.q||''}%`,req.user.id]); res.json(r.rows.map(safeUser)); });
app.post('/api/friends/request',auth,async(req,res)=>{ try { if(!req.body.userId||req.body.userId===req.user.id)return res.status(400).json({error:'Neispravan korisnik.'}); const existing=await q(`SELECT status FROM friendships WHERE (requester=$1 AND addressee=$2) OR (requester=$2 AND addressee=$1) ORDER BY (status='blocked') DESC LIMIT 1`,[req.user.id,req.body.userId]); if(existing.rows[0]?.status==='blocked')return res.status(403).json({error:'Zahtev nije moguć zbog blokade.'}); if(existing.rows[0]?.status==='accepted')return res.status(409).json({error:'Već ste prijatelji.'}); if(existing.rows[0]?.status==='pending')return res.status(409).json({error:'Zahtev već postoji.'}); await q(`DELETE FROM friendships WHERE ((requester=$1 AND addressee=$2) OR (requester=$2 AND addressee=$1)) AND status<>'blocked'`,[req.user.id,req.body.userId]); await q(`INSERT INTO friendships(requester,addressee,status) SELECT $1,$2,'pending' WHERE NOT EXISTS(SELECT 1 FROM friendships WHERE ((requester=$1 AND addressee=$2) OR (requester=$2 AND addressee=$1)) AND status='blocked') ON CONFLICT DO NOTHING`,[req.user.id,req.body.userId]); res.json({ok:true}); } catch { res.status(400).json({error:'Zahtev nije moguće poslati.'}); }});
app.get('/api/friends',auth,async(req,res)=>{ const r=await q(`SELECT u.id,u.username,u.created_at,f.status,f.requester FROM friendships f JOIN users u ON u.id=CASE WHEN f.requester=$1 THEN f.addressee ELSE f.requester END WHERE f.requester=$1 OR f.addressee=$1 ORDER BY f.created_at DESC`,[req.user.id]); res.json(r.rows.map(x=>({...safeUser(x),status:x.status,received:x.requester!==req.user.id}))); });
app.post('/api/friends/respond',auth,async(req,res)=>{ await q(`UPDATE friendships SET status=$1 WHERE requester=$2 AND addressee=$3 AND status='pending'`,[req.body.status==='accepted'?'accepted':'declined',req.body.id,req.user.id]); res.json({ok:true}); });
app.delete('/api/friends/:userId',auth,async(req,res)=>{ await q(`DELETE FROM friendships WHERE ((requester=$1 AND addressee=$2) OR (requester=$2 AND addressee=$1)) AND status<>'blocked'`,[req.user.id,req.params.userId]); res.json({ok:true}); });
app.post('/api/friends/block',auth,async(req,res)=>{ if(req.body.userId===req.user.id)return res.status(400).json({error:'Ne možeš blokirati samog sebe.'}); await q(`DELETE FROM friendships WHERE ((requester=$1 AND addressee=$2) OR (requester=$2 AND addressee=$1)) AND status<>'blocked'`,[req.user.id,req.body.userId]); await q(`INSERT INTO friendships(requester,addressee,status) VALUES($1,$2,'blocked') ON CONFLICT(requester,addressee) DO UPDATE SET status='blocked'`,[req.user.id,req.body.userId]); res.json({ok:true}); });
app.delete('/api/friends/block/:userId',auth,async(req,res)=>{ await q(`DELETE FROM friendships WHERE requester=$1 AND addressee=$2 AND status='blocked'`,[req.user.id,req.params.userId]); res.json({ok:true}); });

const canSeeStatus = async (req,res,next)=>{
  const r=await q(`SELECT 1 FROM statuses s WHERE s.id=$1 AND (s.user_id=$2 OR EXISTS(SELECT 1 FROM friendships f WHERE ((f.requester=$2 AND f.addressee=s.user_id) OR (f.addressee=$2 AND f.requester=s.user_id)) AND f.status='accepted')) AND NOT EXISTS(SELECT 1 FROM friendships f WHERE ((f.requester=$2 AND f.addressee=s.user_id) OR (f.addressee=$2 AND f.requester=s.user_id)) AND f.status='blocked')`,[req.params.id,req.user.id]);
  if(!r.rows[0])return res.status(404).json({error:'Status nije dostupan.'});
  next();
};

app.post('/api/statuses',auth,async(req,res)=>{ const body=String(req.body.body||'').trim(); if(!body||body.length>280) return res.status(400).json({error:'Status mora imati od 1 do 280 karaktera.'}); const r=await q('INSERT INTO statuses(user_id,body) VALUES($1,$2) RETURNING *',[req.user.id,body]); res.json(r.rows[0]); });
app.delete('/api/statuses/:id',auth,async(req,res)=>{ const r=await q('DELETE FROM statuses WHERE id=$1 AND user_id=$2 RETURNING id',[req.params.id,req.user.id]); if(!r.rows[0])return res.status(404).json({error:'Status nije pronađen.'}); res.json({ok:true}); });
app.patch('/api/statuses/:id',auth,async(req,res)=>{ const body=String(req.body.body||'').trim(); if(!body||body.length>280)return res.status(400).json({error:'Status mora imati od 1 do 280 karaktera.'}); const r=await q('UPDATE statuses SET body=$1 WHERE id=$2 AND user_id=$3 RETURNING id,body,created_at',[body,req.params.id,req.user.id]); if(!r.rows[0])return res.status(404).json({error:'Status nije pronađen.'}); res.json(r.rows[0]); });
app.post('/api/statuses/:id/like',auth,canSeeStatus,async(req,res)=>{ const exists=await q('SELECT 1 FROM status_likes WHERE status_id=$1 AND user_id=$2',[req.params.id,req.user.id]); if(exists.rows[0])await q('DELETE FROM status_likes WHERE status_id=$1 AND user_id=$2',[req.params.id,req.user.id]); else await q('INSERT INTO status_likes(status_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[req.params.id,req.user.id]); res.json({liked:!exists.rows[0]}); });
app.get('/api/statuses/:id/replies',auth,canSeeStatus,async(req,res)=>{ const r=await q('SELECT r.id,r.body,r.created_at,u.username FROM status_replies r JOIN users u ON u.id=r.user_id WHERE r.status_id=$1 ORDER BY r.created_at ASC',[req.params.id]); res.json(r.rows); });
app.post('/api/statuses/:id/replies',auth,canSeeStatus,async(req,res)=>{ const body=String(req.body.body||'').trim(); if(!body||body.length>280)return res.status(400).json({error:'Odgovor mora imati od 1 do 280 karaktera.'}); const r=await q('INSERT INTO status_replies(status_id,user_id,body) VALUES($1,$2,$3) RETURNING id,body,created_at',[req.params.id,req.user.id,body]); res.json(r.rows[0]); });
app.post('/api/statuses/:id/report',auth,canSeeStatus,async(req,res)=>{ const reason=String(req.body.reason||'').trim(); if(reason.length>280)return res.status(400).json({error:'Razlog može imati najviše 280 karaktera.'}); const status=await q('SELECT user_id FROM statuses WHERE id=$1',[req.params.id]); if(!status.rows[0])return res.status(404).json({error:'Status nije pronađen.'}); if(status.rows[0].user_id===req.user.id)return res.status(400).json({error:'Ne možeš prijaviti svoj status.'}); await q('INSERT INTO status_reports(status_id,reporter_id,reason) VALUES($1,$2,$3) ON CONFLICT(status_id,reporter_id) DO UPDATE SET reason=excluded.reason,created_at=now()',[req.params.id,req.user.id,reason]); res.json({ok:true}); });
app.get('/api/feed',auth,async(req,res)=>{ const r=await q(`SELECT s.id,s.body,s.created_at,u.username,(SELECT count(*) FROM status_likes l WHERE l.status_id=s.id) likes FROM statuses s JOIN users u ON u.id=s.user_id WHERE (s.user_id=$1 OR s.user_id IN (SELECT CASE WHEN requester=$1 THEN addressee ELSE requester END FROM friendships WHERE (requester=$1 OR addressee=$1) AND status='accepted')) AND NOT EXISTS(SELECT 1 FROM friendships f WHERE ((f.requester=$1 AND f.addressee=s.user_id) OR (f.addressee=$1 AND f.requester=s.user_id)) AND f.status='blocked') ORDER BY s.created_at DESC LIMIT 50`,[req.user.id]); res.json(r.rows); });
app.post('/api/challenges',auth,async(req,res)=>{ const relation=await q(`SELECT 1 FROM friendships WHERE ((requester=$1 AND addressee=$2) OR (requester=$2 AND addressee=$1)) AND status='accepted'`,[req.user.id,req.body.userId]); if(!relation.rows[0])return res.status(403).json({error:'Izazov možeš poslati samo prijatelju.'}); const blocked=await q(`SELECT 1 FROM friendships WHERE ((requester=$1 AND addressee=$2) OR (requester=$2 AND addressee=$1)) AND status='blocked'`,[req.user.id,req.body.userId]); if(blocked.rows[0])return res.status(403).json({error:'Izazov nije moguć zbog blokade.'}); const id=crypto.randomUUID(); await q(`INSERT INTO challenges(id,challenger,opponent,expires_at) VALUES($1,$2,$3,now()+interval '24 hours')`,[id,req.user.id,req.body.userId]); res.json({id}); });
app.get('/api/challenges',auth,async(req,res)=>{ const r=await q(`SELECT c.id,c.status,c.created_at,c.expires_at,u.username AS challenger FROM challenges c JOIN users u ON u.id=c.challenger WHERE c.opponent=$1 AND c.status='pending' AND c.expires_at>now() ORDER BY c.created_at DESC`,[req.user.id]); res.json(r.rows); });
app.post('/api/challenges/:id/respond',auth,async(req,res)=>{
  if(req.body.status!=='accepted'){await q("UPDATE challenges SET status='declined' WHERE id=$1 AND opponent=$2 AND status='pending'",[req.params.id,req.user.id]);return res.json({ok:true});}
  const c=await q(`UPDATE challenges c SET status='accepted' FROM users u WHERE c.id=$1 AND c.opponent=$2 AND c.status='pending' AND c.expires_at>now() AND u.id=c.challenger AND EXISTS(SELECT 1 FROM friendships f WHERE ((f.requester=c.challenger AND f.addressee=c.opponent) OR (f.requester=c.opponent AND f.addressee=c.challenger)) AND f.status='accepted') AND NOT EXISTS(SELECT 1 FROM friendships f WHERE ((f.requester=c.challenger AND f.addressee=c.opponent) OR (f.requester=c.opponent AND f.addressee=c.challenger)) AND f.status='blocked') RETURNING c.*,u.username AS challenger_name`,[req.params.id,req.user.id]);
  if(!c.rows[0])return res.status(404).json({error:'Izazov nije dostupan.'});
  const id=newGame(c.rows[0].challenger,c.rows[0].opponent,{playerNames:{w:c.rows[0].challenger_name,b:req.user.username}});
  io.to('user:'+c.rows[0].challenger).emit('challenge-accepted',{gameId:id});
  res.json({ok:true,gameId:id});
});

function newGame(a=null,b=null,options={}){ if(games.size>=1000 || [...games.values()].filter(g=>!g.ended&&(g.players.w===a||g.players.b===a)).length>=5) {const e=new Error('Previše aktivnih partija.');e.status=429;throw e;} const id=crypto.randomUUID(); games.set(id,{id,chess:new Chess(),players:{w:a,b},playerNames:{w:options.playerNames?.w||'Anonimni igrač',b:options.playerNames?.b||null},progress:{w:0,b:0},anonProgress:{},drawOffer:null,unlocked:false,lastMove:null,bot:options.bot||null,botThinking:false,createdAt:Date.now()}); return id; }
function findGame(idOrCode){ const value=String(idOrCode||''); if(games.has(value))return games.get(value); if(value.length<8)return null; const matches=[...games.values()].filter(game=>game.id.startsWith(value)); return matches.length===1?matches[0]:null; }
app.post('/api/games',optionalAuth,async(req,res)=>{ const playerId=identity(req)||`anon:${crypto.randomUUID()}`; const id=newGame(playerId,null,{playerNames:{w:playerName(req)}}); res.json({id,joinCode:id.slice(0,8),playerId,color:'w'}); });
app.post('/api/games/bot',optionalAuth,async(req,res)=>{ const playerId=identity(req)||`anon:${crypto.randomUUID()}`; const id=newGame(playerId,'bot:top',{bot:{color:'b',name:'TOP Bot'},playerNames:{w:playerName(req),b:'TOP Bot'}}); res.json({id,playerId,color:'w',bot:true}); });
app.post('/api/games/:id/join',optionalAuth,async(req,res)=>{ const g=findGame(req.params.id); if(!g)return res.status(404).json({error:'Partija nije pronađena.'}); g.playerNames ||= {w:null,b:null}; const playerId=identity(req)||`anon:${crypto.randomUUID()}`; if(g.players.w===playerId){g.playerNames.w ||= playerName(req);return res.json({ok:true,id:g.id,playerId,color:'w'});} if(!g.players.b){g.players.b=playerId;g.playerNames.b=playerName(req);} if(g.players.b!==playerId)return res.status(409).json({error:'Partija je već popunjena.'}); io.to(g.id).emit('state',gameState(g)); res.json({ok:true,id:g.id,playerId,color:'b'}); });
app.get('/api/games/:id',optionalAuth,async(req,res)=>{ const g=findGame(req.params.id); if(!g) return res.status(404).json({error:'Partija ne postoji ili je završena.'}); if(!isMember(g,identity(req)))return res.status(403).json({error:'Nisi igrač ove partije.'}); res.json(gameState(g)); });
function scheduleBotMove(g){
  if(!g.bot||g.botThinking||g.ended||g.chess.isGameOver()||g.chess.turn()!==g.bot.color)return;
  g.botThinking=true;
  g.botTimer=setTimeout(async()=>{
    try {
      if(!g.ended&&!g.chess.isGameOver()){
        const fen=g.chess.fen(); const move=await botMove(fen); if(g.ended || g.chess.fen()!==fen)return;
        if(move){const played=g.chess.move(move);g.lastMove={from:played.from,to:played.to};}
        if(g.chess.isGameOver()){g.ended=true;g.unlocked=false;delete g.chatKeys;g.endReason=endReason(g.chess);}
      }
    } catch {
      g.ended=true;
      g.endReason='bot nije dostupan';
    } finally {
      g.botThinking=false;
      g.botTimer=null;
      io.to(g.id).emit('state',gameState(g));
    }
  },420);
}
app.post('/api/games/:id/move',optionalAuth,async(req,res)=>{ const g=findGame(req.params.id); if(!g) return res.status(404).json({error:'Partija nije pronađena.'}); try { if(!g.players.b)return res.status(409).json({error:'Sačekaj da se protivnik pridruži.'}); if(g.ended||g.chess.isGameOver())return res.status(409).json({error:'Partija je završena.'}); const playerId=identity(req); const color=g.players.w===playerId?'w':g.players.b===playerId?'b':null; if(!color||g.chess.turn()!==color)return res.status(403).json({error:'Nisi na potezu ili nisi igrač ove partije.'}); if(!g.bot&&!String(playerId).startsWith('anon:')){
  g.secretLoaded ||= {};
  if(!g.secretLoaded[color]){
    const r=await q('SELECT secret_moves FROM users WHERE id=$1',[g.players[color]]);
    g.secretLoaded[color]=normaliseSecretMoves(r.rows[0]?.secret_moves)[color];
  }
}
if(g.ended||g.chess.isGameOver()||g.chess.turn()!==color)return res.status(409).json({error:'Stanje partije se promenilo.'});
const move=g.chess.move(req.body.move); if(!move) throw Error(); g.drawOffer=null; const played={from:move.from,to:move.to,promotion:move.promotion||null}; g.lastMove={from:move.from,to:move.to}; const isAnonymous=String(playerId).startsWith('anon:'); if(!g.bot&&isAnonymous){ const secret=anonymousSecret[color]; g.anonProgress[playerId]=advanceSequence(secret,g.anonProgress[playerId]||0,played); if(g.anonProgress[playerId]>=5&&secret.length===5)g.unlocked=true; } else if(!g.bot) { const secret=g.secretLoaded?.[color]||[]; g.progress[color]=advanceSequence(secret,g.progress[color],played); if(g.progress.w>=5&&g.progress.b>=5)g.unlocked=true; } if(g.chess.isGameOver()){g.ended=true;g.unlocked=false;delete g.chatKeys;g.endReason=endReason(g.chess);} else scheduleBotMove(g); const state=gameState(g); io.to(g.id).emit('state',state); res.json({ok:true,move,...state}); } catch { res.status(400).json({error:'Neispravan potez.'}); }});
app.post('/api/games/:id/resign',optionalAuth,async(req,res)=>{ const g=findGame(req.params.id); if(!g)return res.status(404).end(); if(!isMember(g,identity(req)))return res.status(403).json({error:'Nisi igrač ove partije.'}); if(g.ended||g.chess.isGameOver())return res.status(409).json({error:'Partija je već završena.'}); if(g.botTimer){clearTimeout(g.botTimer);g.botTimer=null;g.botThinking=false;} g.ended=true; g.unlocked=false;delete g.chatKeys; g.endReason='predaja'; io.to(g.id).emit('ended',{reason:g.endReason}); res.json({ok:true,...gameState(g)}); });
app.post('/api/games/:id/draw-offer',optionalAuth,async(req,res)=>{ const g=findGame(req.params.id); const playerId=identity(req); if(!g||!isMember(g,playerId))return res.status(403).json({error:'Nisi igrač ove partije.'}); if(g.bot)return res.status(400).json({error:'Bot ne prihvata ponudu remija.'}); if(!g.players.b)return res.status(409).json({error:'Sačekaj da se protivnik pridruži.'}); if(g.ended||g.chess.isGameOver())return res.status(400).json({error:'Partija je završena.'}); g.drawOffer=playerId; io.to(g.id).emit('draw-offer',{offeredBy:playerId}); res.json({ok:true}); });
app.post('/api/games/:id/draw-accept',optionalAuth,async(req,res)=>{ const g=findGame(req.params.id); const playerId=identity(req); if(!g||!isMember(g,playerId)||!g.drawOffer||g.drawOffer===playerId)return res.status(400).json({error:'Nema ponude remija.'}); if(g.ended||g.chess.isGameOver())return res.status(409).json({error:'Partija je već završena.'}); g.ended=true; g.unlocked=false;delete g.chatKeys; g.endReason='remi'; io.to(g.id).emit('ended',{reason:g.endReason}); res.json({ok:true,...gameState(g)}); });
app.post('/api/games/:id/draw-decline',optionalAuth,async(req,res)=>{ const g=findGame(req.params.id); const playerId=identity(req); if(!g||!isMember(g,playerId))return res.status(403).json({error:'Nisi igrač ove partije.'}); g.drawOffer=null; io.to(g.id).emit('draw-declined'); res.json({ok:true}); });
io.use(async(socket,next)=>{
  try {
    const session=await sessions.read(cookies(socket.handshake.headers.cookie).top_session);
    if(!session)return next(new Error('Potrebna je sesija.'));
    if(!limiter.take('socket-connect:'+session.id,20))return next(new Error('Previše veza.'));
    if([...io.sockets.sockets.values()].filter(s=>s.data.session?.id===session.id).length>=6)return next(new Error('Previše veza.'));
    socket.data.session=session;
    next();
  } catch {next(new Error('Sesija nije dostupna.'));}
});
io.on('connection',socket=>{
  const session=socket.data.session;
  if(session.kind==='user'){socket.join('user:'+session.id);socket.join('session:'+session.sid);}else socket.join('guest:'+session.id);
  const expiry=setInterval(()=>{if(session.exp*1000<=Date.now())socket.disconnect(true);},30000);
  socket.on('disconnect',()=>clearInterval(expiry));
  let events=Promise.resolve();
  const handle=(event,fn)=>socket.on(event,(payload)=>{
    if(!limiter.take('socket-events:'+session.id,60))return;
    events=events.then(async()=>{
    try{
      const current=await sessions.read(cookies(socket.handshake.headers.cookie).top_session);
      if(!current){socket.disconnect(true);return;}
      await fn(payload,current);
    }catch{socket.emit('request-error',{error:'Zahtev nije ispravan.'});}
    });
  });
  handle('join-game',async(id,current)=>{
    if(typeof id!=='string'||id.length>36)return;
    const g=findGame(id); if(!isMember(g,current.id))return;
    if(socket.data.game)await socket.leave(socket.data.game);
    await socket.join(g.id);socket.data.game=g.id;
  });
  handle('chat-key',async(payload,current)=>{
    if(!payload||typeof payload.gameId!=='string'||typeof payload.publicKey!=='string'||!/^[A-Za-z0-9+/]{87}=$/.test(payload.publicKey))return;
    const g=findGame(payload.gameId);
    if(!isMember(g,current.id)||socket.data.game!==g.id||!g.unlocked||g.ended||g.chess.isGameOver())return;
    if(!limiter.take('chat-keys:'+current.id,10))return;
    const bytes=Buffer.from(payload.publicKey,'base64'); if(bytes.length!==65||bytes[0]!==4)return;
    g.chatKeys ||= new Map();g.chatKeys.set(current.id,payload.publicKey);
    socket.to(g.id).emit('chat-key',{gameId:g.id,playerId:current.id,publicKey:payload.publicKey});
    for(const [id,key] of g.chatKeys)if(id!==current.id)socket.emit('chat-key',{gameId:g.id,playerId:id,publicKey:key});
  });
  handle('chat-message',async(payload,current)=>{
    if(!payload || typeof payload!=='object' || typeof payload.gameId!=='string')return;
    const g=findGame(payload.gameId), e=payload.envelope;
    if(!isMember(g,current.id)||socket.data.game!==g.id||!g.unlocked||g.ended||g.chess.isGameOver()||!e||typeof e!=='object')return;
    if(!Number.isSafeInteger(e.sequence)||e.sequence<1||typeof e.channel!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(e.channel)||typeof e.iv!=='string'||!/^[A-Za-z0-9+/]{16}$/.test(e.iv)||typeof e.ciphertext!=='string'||e.ciphertext.length<24||e.ciphertext.length>5500||!/^[A-Za-z0-9+/]+=*$/.test(e.ciphertext))return;
    if(!limiter.take('chat:'+current.id,20,10000))return;
    // Never relay arbitrary fields (including plaintext), log, queue or persist messages.
    io.to(g.id).emit('chat-message',{envelope:{channel:e.channel,sequence:e.sequence,iv:e.iv,ciphertext:e.ciphertext},sender:current.username||'Anonimni igrač',playerId:current.id});
  });
});
setInterval(()=>{
  const cutoff=Date.now()-86400000;
  for(const [id,g] of games)if(g.createdAt<cutoff){
    if(g.botTimer)clearTimeout(g.botTimer);
    io.to(id).emit('ended',{reason:'istekla sesija partije'});io.in(id).socketsLeave(id);games.delete(id);
  }
  if(pool)q('DELETE FROM sessions WHERE expires_at<=now()').catch(()=>{});
},60000).unref();
app.use((error,req,res,next)=>{
  if(res.headersSent)return next(error);
  const status=error.status===429?429:error.type==='entity.too.large'?413:error instanceof SyntaxError||error.code==='22P02'?400:500;
  res.status(status).json({error:status===429?'Previše aktivnih partija.':status===400?'Neispravan zahtev.':'Zahtev nije moguće obraditi.'});
});
app.get('*',(req,res)=>{
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(__dirname,'public/index.html'));
});
async function start(){
  if(process.env.NODE_ENV==='production'&&(!process.env.PUBLIC_URL?.startsWith('https://')||Buffer.byteLength(JWT_SECRET)<32||Buffer.byteLength(PEPPER)<32||!process.env.JWT_SECRET||!process.env.MNEMONIC_PEPPER)){
    throw new Error('PUBLIC_URL mora biti HTTPS; JWT_SECRET i MNEMONIC_PEPPER moraju imati najmanje 32 bajta.');
  }
  if(process.env.NODE_ENV==='production'&&!pool){
    throw new Error('PostgreSQL konekcija mora biti podešena u produkciji.');
  }
  if(pool && process.env.RUN_MIGRATIONS !== 'false'){
    const schema=await fs.readFile(path.join(__dirname,'schema.sql'),'utf8');
    await pool.query(schema);
  }
  if(pool && process.env.RUN_MIGRATIONS === 'false')await pool.query('SELECT id FROM sessions LIMIT 0');
  server.listen(PORT,()=>console.log(`TOP sluša na portu ${server.address().port}`));
}
export { server, io };
start().catch(error=>{console.error('Pokretanje aplikacije nije uspelo:',error.message);process.exit(1)});
