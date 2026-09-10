import express from 'express';
import http from 'http';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { Chess } from 'chess.js';
import pg from 'pg';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { advanceSequence, moveForColor, validatePersonalSequence } from './lib/move-sequence.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express(); const server = http.createServer(app); const io = new Server(server);
app.set('trust proxy', 1);
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
const requestBuckets = new Map();
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
app.use(express.json({ limit: '32kb' })); app.use(express.static(path.join(__dirname, 'public')));
app.use((req,res,next)=>{ const key=`${req.ip}:${req.path}`; const now=Date.now(); const recent=(requestBuckets.get(key)||[]).filter(t=>now-t<60000); if(recent.length>=120)return res.status(429).json({error:'Previše zahteva. Pokušaj ponovo za minut.'}); recent.push(now); requestBuckets.set(key,recent); next(); });
const parseCookies = header => Object.fromEntries(String(header||'').split(';').map(item=>item.trim()).filter(Boolean).map(item=>{const at=item.indexOf('=');return at<0?[item,'']:[item.slice(0,at),decodeURIComponent(item.slice(at+1))]}));
const requestToken = req => (req.headers.authorization||'').replace('Bearer ','') || parseCookies(req.headers.cookie).top_session || '';
const sessionCookie = (token,maxAge=2592000,secure=false) => `top_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure?'; Secure':''}`;
const createToken = user => jwt.sign(user,JWT_SECRET,{expiresIn:'30d'});
const auth = (req,res,next)=>{ try { req.user=jwt.verify(requestToken(req),JWT_SECRET); next(); } catch { res.status(401).json({error:'Potrebna je prijava.'}); } };
const optionalAuth = (req,res,next)=>{ try { const token=requestToken(req); if(token) req.user=jwt.verify(token,JWT_SECRET); } catch {} next(); };
const identity = req=>req.user?.id || req.headers['x-player-id'] || null;
const mnemonic = ()=>Array.from({length:12},()=>words[crypto.randomInt(words.length)]).join(' ');
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
const safeUser = r=>({id:r.id,username:r.username,createdAt:r.created_at});
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
  history:g.chess.history(),
  players:g.players,
  ready:Boolean(g.players.w&&g.players.b),
  chatUnlocked:Boolean(g.unlocked&&!g.ended&&!g.chess.isGameOver()),
  gameOver:Boolean(g.ended||g.chess.isGameOver()),
  endReason:g.endReason||endReason(g.chess)
});

app.get('/api/health',async(req,res)=>{ if(!pool)return res.status(503).json({ok:false,name:'TOP',database:'not-configured'}); try { await pool.query('SELECT 1'); res.json({ok:true,name:'TOP',database:'connected',time:new Date().toISOString()}); } catch { res.status(503).json({ok:false,name:'TOP',database:'unavailable'}); } });
app.post('/api/auth/register',async(req,res)=>{ try { const username=String(req.body.username||'').trim(); const password=String(req.body.password||''); if(!/^[a-zA-Z0-9_]{3,24}$/.test(username)||password.length<8) return res.status(400).json({error:'Korisničko ime mora imati 3–24 slova, broja ili _, a lozinka najmanje 8 karaktera.'}); const phrase=mnemonic(); const h=await bcrypt.hash(password,12); const r=await q('INSERT INTO users(username,password_hash,mnemonic_hash) VALUES($1,$2,$3) RETURNING *',[username,h,hashMnemonic(phrase)]); const u=safeUser(r.rows[0]); res.setHeader('Set-Cookie',sessionCookie(createToken(u),2592000,req.secure)); res.status(201).json({user:u,mnemonic:phrase}); } catch(e){ if(e.code==='23505')return res.status(409).json({error:'Korisničko ime već postoji.'}); if(databaseUnavailable(e))return res.status(503).json({error:'Registracija trenutno nije dostupna jer PostgreSQL baza nije povezana.'}); res.status(500).json({error:'Registracija nije uspela. Pokušaj ponovo.'}); }});
app.post('/api/auth/login',async(req,res)=>{ try { const r=await q('SELECT * FROM users WHERE lower(username)=lower($1)',[req.body.username]); if(!r.rows[0]||!(await bcrypt.compare(req.body.password||'',r.rows[0].password_hash))) return res.status(401).json({error:'Pogrešno korisničko ime ili lozinka.'}); const u=safeUser(r.rows[0]); res.setHeader('Set-Cookie',sessionCookie(createToken(u),2592000,req.secure)); res.json({user:u}); } catch(e) { res.status(databaseUnavailable(e)?503:500).json({error:'Baza nije dostupna.'}); }});
app.post('/api/auth/logout',(req,res)=>{ res.setHeader('Set-Cookie',sessionCookie('',0,req.secure)); res.json({ok:true}); });
app.post('/api/auth/recover',async(req,res)=>{ try { const phrase=(req.body.mnemonic||'').trim().toLowerCase(); if(!/^[a-z ]+$/.test(phrase)) return res.status(400).json({error:'Mnemonic fraza sme sadržati samo slova bez dijakritike.'}); const r=await q('SELECT * FROM users WHERE lower(username)=lower($1) AND mnemonic_hash=$2',[req.body.username,hashMnemonic(phrase)]); if(!r.rows[0]) return res.status(400).json({error:'Podaci za oporavak nisu ispravni.'}); await q('UPDATE users SET password_hash=$1 WHERE id=$2',[await bcrypt.hash(req.body.password,12),r.rows[0].id]); res.json({ok:true}); } catch { res.status(500).json({error:'Oporavak nije uspeo.'}); }});
app.post('/api/auth/change-password',auth,async(req,res)=>{ try { const current=String(req.body.currentPassword||''); const next=String(req.body.newPassword||''); if(next.length<8)return res.status(400).json({error:'Nova lozinka mora imati najmanje 8 karaktera.'}); const r=await q('SELECT password_hash FROM users WHERE id=$1',[req.user.id]); if(!r.rows[0]||!(await bcrypt.compare(current,r.rows[0].password_hash)))return res.status(400).json({error:'Trenutna lozinka nije ispravna.'}); await q('UPDATE users SET password_hash=$1 WHERE id=$2',[await bcrypt.hash(next,12),req.user.id]); res.json({ok:true}); } catch { res.status(500).json({error:'Promena lozinke nije uspela.'}); }});
app.get('/api/me',auth,async(req,res)=>{ const r=await q('SELECT id,username,created_at FROM users WHERE id=$1',[req.user.id]); res.json(safeUser(r.rows[0])); });
app.get('/api/profile/secret-moves',auth,async(req,res)=>{ const r=await q('SELECT secret_moves FROM users WHERE id=$1',[req.user.id]); res.json({moves:normaliseSecretMoves(r.rows[0]?.secret_moves)}); });
app.post('/api/profile/secret-moves/validate',auth,async(req,res)=>{ try { const moves=Array.isArray(req.body.moves)?req.body.moves:[]; const color=req.body.color==='b'?'b':'w'; const result=validatePersonalSequence(moves,5,color); res.json({valid:true,complete:moves.length===5,fen:result.fen,history:result.history,color}); } catch { res.status(400).json({valid:false,error:'Sekvenca sadrži nelegalan potez.'}); }});
app.put('/api/profile/secret-moves',auth,async(req,res)=>{ try { const moves=normaliseSecretMoves(req.body.moves); if(moves.w.length!==5||moves.b.length!==5) return res.status(400).json({error:'Unesi tačno pet legalnih poteza i za bele i za crne figure.'}); const result={w:validatePersonalSequence(moves.w,5,'w').history,b:validatePersonalSequence(moves.b,5,'b').history}; await q('UPDATE users SET secret_moves=$1 WHERE id=$2',[JSON.stringify(result),req.user.id]); res.json({ok:true,message:'Obe sekvence su sačuvane.'}); } catch { res.status(400).json({error:'Potezi nisu sačuvani. Proveri obe sekvence.'}); }});
app.get('/api/users/search',auth,async(req,res)=>{ const r=await q('SELECT id,username,created_at FROM users WHERE username ILIKE $1 AND id<>$2 LIMIT 20',[`${req.query.q||''}%`,req.user.id]); res.json(r.rows.map(safeUser)); });
app.post('/api/friends/request',auth,async(req,res)=>{ try { if(!req.body.userId||req.body.userId===req.user.id)return res.status(400).json({error:'Neispravan korisnik.'}); const existing=await q(`SELECT status FROM friendships WHERE (requester=$1 AND addressee=$2) OR (requester=$2 AND addressee=$1) LIMIT 1`,[req.user.id,req.body.userId]); if(existing.rows[0]?.status==='blocked')return res.status(403).json({error:'Zahtev nije moguć zbog blokade.'}); if(existing.rows[0]?.status==='accepted')return res.status(409).json({error:'Već ste prijatelji.'}); if(existing.rows[0]?.status==='pending')return res.status(409).json({error:'Zahtev već postoji.'}); await q(`DELETE FROM friendships WHERE (requester=$1 AND addressee=$2) OR (requester=$2 AND addressee=$1)`,[req.user.id,req.body.userId]); await q(`INSERT INTO friendships(requester,addressee,status) VALUES($1,$2,'pending')`,[req.user.id,req.body.userId]); res.json({ok:true}); } catch { res.status(400).json({error:'Zahtev nije moguće poslati.'}); }});
app.get('/api/friends',auth,async(req,res)=>{ const r=await q(`SELECT u.id,u.username,u.created_at,f.status,f.requester FROM friendships f JOIN users u ON u.id=CASE WHEN f.requester=$1 THEN f.addressee ELSE f.requester END WHERE f.requester=$1 OR f.addressee=$1 ORDER BY f.created_at DESC`,[req.user.id]); res.json(r.rows.map(x=>({...safeUser(x),status:x.status,received:x.requester!==req.user.id}))); });
app.post('/api/friends/respond',auth,async(req,res)=>{ await q(`UPDATE friendships SET status=$1 WHERE requester=$2 AND addressee=$3 AND status='pending'`,[req.body.status==='accepted'?'accepted':'declined',req.body.id,req.user.id]); res.json({ok:true}); });
app.delete('/api/friends/:userId',auth,async(req,res)=>{ await q(`DELETE FROM friendships WHERE (requester=$1 AND addressee=$2) OR (requester=$2 AND addressee=$1)`,[req.user.id,req.params.userId]); res.json({ok:true}); });
app.post('/api/friends/block',auth,async(req,res)=>{ if(req.body.userId===req.user.id)return res.status(400).json({error:'Ne možeš blokirati samog sebe.'}); await q(`DELETE FROM friendships WHERE (requester=$1 AND addressee=$2) OR (requester=$2 AND addressee=$1)`,[req.user.id,req.body.userId]); await q(`INSERT INTO friendships(requester,addressee,status) VALUES($1,$2,'blocked')`,[req.user.id,req.body.userId]); res.json({ok:true}); });
app.delete('/api/friends/block/:userId',auth,async(req,res)=>{ await q(`DELETE FROM friendships WHERE requester=$1 AND addressee=$2 AND status='blocked'`,[req.user.id,req.params.userId]); res.json({ok:true}); });
app.post('/api/statuses',auth,async(req,res)=>{ const body=String(req.body.body||'').trim(); if(!body||body.length>280) return res.status(400).json({error:'Status mora imati od 1 do 280 karaktera.'}); const r=await q('INSERT INTO statuses(user_id,body) VALUES($1,$2) RETURNING *',[req.user.id,body]); res.json(r.rows[0]); });
app.delete('/api/statuses/:id',auth,async(req,res)=>{ const r=await q('DELETE FROM statuses WHERE id=$1 AND user_id=$2 RETURNING id',[req.params.id,req.user.id]); if(!r.rows[0])return res.status(404).json({error:'Status nije pronađen.'}); res.json({ok:true}); });
app.patch('/api/statuses/:id',auth,async(req,res)=>{ const body=String(req.body.body||'').trim(); if(!body||body.length>280)return res.status(400).json({error:'Status mora imati od 1 do 280 karaktera.'}); const r=await q('UPDATE statuses SET body=$1 WHERE id=$2 AND user_id=$3 RETURNING id,body,created_at',[body,req.params.id,req.user.id]); if(!r.rows[0])return res.status(404).json({error:'Status nije pronađen.'}); res.json(r.rows[0]); });
app.post('/api/statuses/:id/like',auth,async(req,res)=>{ const exists=await q('SELECT 1 FROM status_likes WHERE status_id=$1 AND user_id=$2',[req.params.id,req.user.id]); if(exists.rows[0])await q('DELETE FROM status_likes WHERE status_id=$1 AND user_id=$2',[req.params.id,req.user.id]); else await q('INSERT INTO status_likes(status_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[req.params.id,req.user.id]); res.json({liked:!exists.rows[0]}); });
app.get('/api/statuses/:id/replies',auth,async(req,res)=>{ const r=await q('SELECT r.id,r.body,r.created_at,u.username FROM status_replies r JOIN users u ON u.id=r.user_id WHERE r.status_id=$1 ORDER BY r.created_at ASC',[req.params.id]); res.json(r.rows); });
app.post('/api/statuses/:id/replies',auth,async(req,res)=>{ const body=String(req.body.body||'').trim(); if(!body||body.length>280)return res.status(400).json({error:'Odgovor mora imati od 1 do 280 karaktera.'}); const r=await q('INSERT INTO status_replies(status_id,user_id,body) VALUES($1,$2,$3) RETURNING id,body,created_at',[req.params.id,req.user.id,body]); res.json(r.rows[0]); });
app.post('/api/statuses/:id/report',auth,async(req,res)=>{ const reason=String(req.body.reason||'').trim(); if(reason.length>280)return res.status(400).json({error:'Razlog može imati najviše 280 karaktera.'}); const status=await q('SELECT user_id FROM statuses WHERE id=$1',[req.params.id]); if(!status.rows[0])return res.status(404).json({error:'Status nije pronađen.'}); if(status.rows[0].user_id===req.user.id)return res.status(400).json({error:'Ne možeš prijaviti svoj status.'}); await q('INSERT INTO status_reports(status_id,reporter_id,reason) VALUES($1,$2,$3) ON CONFLICT(status_id,reporter_id) DO UPDATE SET reason=excluded.reason,created_at=now()',[req.params.id,req.user.id,reason]); res.json({ok:true}); });
app.get('/api/feed',auth,async(req,res)=>{ const r=await q(`SELECT s.id,s.body,s.created_at,u.username,(SELECT count(*) FROM status_likes l WHERE l.status_id=s.id) likes FROM statuses s JOIN users u ON u.id=s.user_id WHERE s.user_id=$1 OR s.user_id IN (SELECT CASE WHEN requester=$1 THEN addressee ELSE requester END FROM friendships WHERE (requester=$1 OR addressee=$1) AND status='accepted') ORDER BY s.created_at DESC LIMIT 50`,[req.user.id]); res.json(r.rows); });
app.post('/api/challenges',auth,async(req,res)=>{ const relation=await q(`SELECT 1 FROM friendships WHERE ((requester=$1 AND addressee=$2) OR (requester=$2 AND addressee=$1)) AND status='accepted'`,[req.user.id,req.body.userId]); if(!relation.rows[0])return res.status(403).json({error:'Izazov možeš poslati samo prijatelju.'}); const blocked=await q(`SELECT 1 FROM friendships WHERE ((requester=$1 AND addressee=$2) OR (requester=$2 AND addressee=$1)) AND status='blocked'`,[req.user.id,req.body.userId]); if(blocked.rows[0])return res.status(403).json({error:'Izazov nije moguć zbog blokade.'}); const id=crypto.randomUUID(); await q(`INSERT INTO challenges(id,challenger,opponent,expires_at) VALUES($1,$2,$3,now()+interval '24 hours')`,[id,req.user.id,req.body.userId]); res.json({id}); });
app.get('/api/challenges',auth,async(req,res)=>{ const r=await q(`SELECT c.id,c.status,c.created_at,c.expires_at,u.username AS challenger FROM challenges c JOIN users u ON u.id=c.challenger WHERE c.opponent=$1 AND c.status='pending' AND c.expires_at>now() ORDER BY c.created_at DESC`,[req.user.id]); res.json(r.rows); });
app.post('/api/challenges/:id/respond',auth,async(req,res)=>{ const c=await q(`SELECT * FROM challenges WHERE id=$1 AND opponent=$2 AND status='pending' AND expires_at>now()`,[req.params.id,req.user.id]); if(!c.rows[0])return res.status(404).json({error:'Izazov nije pronađen ili je istekao.'}); if(req.body.status!=='accepted'){await q(`UPDATE challenges SET status='declined' WHERE id=$1`,[req.params.id]);return res.json({ok:true});} await q(`UPDATE challenges SET status='accepted' WHERE id=$1`,[req.params.id]); const id=newGame(c.rows[0].challenger,c.rows[0].opponent); io.to(`user:${c.rows[0].challenger}`).emit('challenge-accepted',{gameId:id}); res.json({ok:true,gameId:id}); });

function newGame(a=null,b=null){ const id=crypto.randomUUID(); games.set(id,{id,chess:new Chess(),players:{w:a,b},progress:{w:0,b:0},anonProgress:{},drawOffer:null,unlocked:false,createdAt:Date.now()}); return id; }
function findGame(idOrCode){ const value=String(idOrCode||''); if(games.has(value))return games.get(value); if(value.length<8)return null; const matches=[...games.values()].filter(game=>game.id.startsWith(value)); return matches.length===1?matches[0]:null; }
app.post('/api/games',optionalAuth,async(req,res)=>{ const playerId=identity(req)||`anon:${crypto.randomUUID()}`; const id=newGame(playerId,null); res.json({id,joinCode:id.slice(0,8),playerId,color:'w'}); });
app.post('/api/games/:id/join',optionalAuth,async(req,res)=>{ const g=findGame(req.params.id); if(!g)return res.status(404).json({error:'Partija nije pronađena.'}); const playerId=identity(req)||`anon:${crypto.randomUUID()}`; if(g.players.w===playerId)return res.json({ok:true,id:g.id,playerId,color:'w'}); if(!g.players.b)g.players.b=playerId; if(g.players.b!==playerId)return res.status(409).json({error:'Partija je već popunjena.'}); io.to(g.id).emit('state',gameState(g)); res.json({ok:true,id:g.id,playerId,color:'b'}); });
app.get('/api/games/:id',async(req,res)=>{ const g=findGame(req.params.id); if(!g) return res.status(404).json({error:'Partija ne postoji ili je završena.'}); res.json(gameState(g)); });
app.post('/api/games/:id/move',optionalAuth,async(req,res)=>{ const g=findGame(req.params.id); if(!g) return res.status(404).json({error:'Partija nije pronađena.'}); try { if(!g.players.b)return res.status(409).json({error:'Sačekaj da se protivnik pridruži.'}); if(g.ended||g.chess.isGameOver())return res.status(409).json({error:'Partija je završena.'}); const playerId=identity(req); const color=g.players.w===playerId?'w':g.players.b===playerId?'b':null; if(!color||g.chess.turn()!==color)return res.status(403).json({error:'Nisi na potezu ili nisi igrač ove partije.'}); const move=g.chess.move(req.body.move); if(!move) throw Error(); g.drawOffer=null; const played={from:move.from,to:move.to,promotion:move.promotion||null}; const isAnonymous=String(playerId).startsWith('anon:'); if(isAnonymous){ const secret=anonymousSecret[color]; g.anonProgress[playerId]=advanceSequence(secret,g.anonProgress[playerId]||0,played); if(g.anonProgress[playerId]>=5&&secret.length===5)g.unlocked=true; } else { if(!g.secretLoaded)g.secretLoaded={}; if(!g.secretLoaded[color]){ const r=await q('SELECT secret_moves FROM users WHERE id=$1',[g.players[color]]); g.secretLoaded[color]=normaliseSecretMoves(r.rows[0]?.secret_moves)[color]; } const secret=g.secretLoaded?.[color]||[]; g.progress[color]=advanceSequence(secret,g.progress[color],played); if(g.progress.w>=5&&g.progress.b>=5)g.unlocked=true; } if(g.chess.isGameOver()){g.ended=true;g.unlocked=false;g.endReason=endReason(g.chess);} const state=gameState(g); io.to(g.id).emit('state',state); res.json({ok:true,move,...state}); } catch { res.status(400).json({error:'Neispravan potez.'}); }});
app.post('/api/games/:id/resign',optionalAuth,async(req,res)=>{ const g=findGame(req.params.id); if(!g)return res.status(404).end(); if(![g.players.w,g.players.b].includes(identity(req)))return res.status(403).json({error:'Nisi igrač ove partije.'}); if(g.ended||g.chess.isGameOver())return res.status(409).json({error:'Partija je već završena.'}); g.ended=true; g.unlocked=false; g.endReason='predaja'; io.to(g.id).emit('ended',{reason:g.endReason}); res.json({ok:true,...gameState(g)}); });
app.post('/api/games/:id/draw-offer',optionalAuth,async(req,res)=>{ const g=findGame(req.params.id); const playerId=identity(req); if(!g||![g.players.w,g.players.b].includes(playerId))return res.status(403).json({error:'Nisi igrač ove partije.'}); if(!g.players.b)return res.status(409).json({error:'Sačekaj da se protivnik pridruži.'}); if(g.ended||g.chess.isGameOver())return res.status(400).json({error:'Partija je završena.'}); g.drawOffer=playerId; io.to(g.id).emit('draw-offer',{offeredBy:playerId}); res.json({ok:true}); });
app.post('/api/games/:id/draw-accept',optionalAuth,async(req,res)=>{ const g=findGame(req.params.id); const playerId=identity(req); if(!g||![g.players.w,g.players.b].includes(playerId)||!g.drawOffer||g.drawOffer===playerId)return res.status(400).json({error:'Nema ponude remija.'}); if(g.ended||g.chess.isGameOver())return res.status(409).json({error:'Partija je već završena.'}); g.ended=true; g.unlocked=false; g.endReason='remi'; io.to(g.id).emit('ended',{reason:g.endReason}); res.json({ok:true,...gameState(g)}); });
app.post('/api/games/:id/draw-decline',optionalAuth,async(req,res)=>{ const g=findGame(req.params.id); const playerId=identity(req); if(!g||![g.players.w,g.players.b].includes(playerId))return res.status(403).json({error:'Nisi igrač ove partije.'}); g.drawOffer=null; io.to(g.id).emit('draw-declined'); res.json({ok:true}); });
const socketIdentity = socket => {
  const token=String(socket.handshake.auth?.token||parseCookies(socket.handshake.headers.cookie).top_session||'');
  if(token){try{return jwt.verify(token,JWT_SECRET).id}catch{}}
  const playerId=String(socket.handshake.auth?.playerId||'');
  return playerId.startsWith('anon:')?playerId:null;
};
io.on('connection',socket=>{ socket.data.playerId=socketIdentity(socket); if(socket.data.playerId&&!String(socket.data.playerId).startsWith('anon:'))socket.join(`user:${socket.data.playerId}`); socket.on('join-game',id=>{ const g=findGame(id); if(!g||![g.players.w,g.players.b].includes(socket.data.playerId))return; socket.join(g.id); socket.data.game=g.id; }); socket.on('chat-message',({gameId,text}={})=>{ const g=findGame(gameId); const clean=String(text||'').trim(); if(!g?.unlocked||g.ended||g.chess.isGameOver()||![g.players.w,g.players.b].includes(socket.data.playerId)||!clean||clean.length>1000)return; io.to(g.id).emit('chat-message',{text:clean,at:Date.now()}); }); });
setInterval(()=>{ const cutoff=Date.now()-86400000; for(const [id,g] of games)if(g.createdAt<cutoff)games.delete(id); const now=Date.now(); for(const [key,times] of requestBuckets) { const active=times.filter(t=>now-t<60000); if(active.length)requestBuckets.set(key,active); else requestBuckets.delete(key); }},3600000);
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public/index.html')));
async function start(){
  if(process.env.NODE_ENV==='production'&&(!process.env.JWT_SECRET||!process.env.MNEMONIC_PEPPER)){
    throw new Error('JWT_SECRET i MNEMONIC_PEPPER moraju biti podešeni u produkciji.');
  }
  if(process.env.NODE_ENV==='production'&&!pool){
    throw new Error('PostgreSQL konekcija mora biti podešena u produkciji.');
  }
  if(pool){
    const schema=await fs.readFile(path.join(__dirname,'schema.sql'),'utf8');
    await pool.query(schema);
  }
  server.listen(PORT,()=>console.log(`TOP sluša na portu ${PORT}`));
}
start().catch(error=>{console.error('Pokretanje aplikacije nije uspelo:',error.message);process.exit(1)});
