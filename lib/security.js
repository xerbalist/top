import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

export const isMember = (game, id) => typeof id === 'string' && id.length > 0 && Boolean(game) && Object.values(game.players).includes(id);
export const validPassword = value => typeof value === 'string' && value.length >= 12 && Buffer.byteLength(value, 'utf8') <= 72;
export function cookies(header) {
  const result = Object.create(null);
  for (const item of String(header || '').split(';')) {
    const at = item.indexOf('=');
    if (at < 0) continue;
    try { result[item.slice(0, at).trim()] = decodeURIComponent(item.slice(at + 1)); } catch { /* Ignore malformed cookies. */ }
  }
  return result;
}

// Fixed windows with a bounded keyspace: arbitrary paths cannot grow memory forever.
export class Limiter {
  constructor(maxKeys = 10000) { this.entries = new Map(); this.maxKeys = maxKeys; }
  take(key, limit, windowMs = 60000) {
    const now = Date.now();
    let entry = this.entries.get(key);
    if (!entry || entry.until <= now) {
      if (!entry && this.entries.size >= this.maxKeys) {
        for (const [k, v] of this.entries) if (v.until <= now) this.entries.delete(k);
        if (this.entries.size >= this.maxKeys) return false;
      }
      entry = { count:0, until:now + windowMs };
      this.entries.set(key, entry);
    }
    return ++entry.count <= limit;
  }
}

export function createSessions({ secret, query, disconnect = () => {} }) {
  const guests = new Map();
  const verify = token => jwt.verify(token, secret, { algorithms:['HS256'], issuer:'top', audience:'top-session' });
  const sign = (payload, expiresIn) => jwt.sign(payload, secret, { algorithm:'HS256', issuer:'top', audience:'top-session', expiresIn });
  return {
    async issue(user) {
      const sid = crypto.randomUUID();
      const r=await query("INSERT INTO sessions(id,user_id,expires_at,auth_version) SELECT $1,id,now()+interval '30 days',auth_version FROM users WHERE id=$2 AND auth_version=$3 RETURNING id", [sid,user.id,user.authVersion||0]);
      if(!r.rows[0])throw new Error('Nalog je promenjen. Prijavi se ponovo.');
      return sign({ id:user.id, username:user.username, sid, kind:'user' }, '30d');
    },
    guest() {
      const now=Date.now();
      for(const [id,expires] of guests)if(expires<=now)guests.delete(id);
      if(guests.size>=10000){const error=new Error('Too many guests');error.status=429;throw error;}
      const id=`anon:${crypto.randomUUID()}`;
      guests.set(id,now+7*86400000);
      return sign({id,kind:'guest'},'7d');
    },
    async read(token) {
      if (!token) return null;
      let claims;
      try { claims = verify(token); } catch { return null; }
      if (claims.kind === 'guest' && /^anon:[0-9a-f-]{36}$/.test(claims.id)) return guests.has(claims.id) ? claims : null;
      if (claims.kind !== 'user' || typeof claims.sid !== 'string') return null;
      const r = await query('SELECT u.id,u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.user_id=$2 AND s.expires_at>now() AND s.auth_version=u.auth_version', [claims.sid,claims.id]);
      return r.rows[0] ? { ...claims, ...r.rows[0] } : null;
    },
    async revoke(session, all = false) {
      if(session?.kind==='guest'){guests.delete(session.id);disconnect('guest:'+session.id);return;}
      if (session?.kind !== 'user') return;
      if (all) await query('DELETE FROM sessions WHERE user_id=$1', [session.id]);
      else await query('DELETE FROM sessions WHERE id=$1', [session.sid]);
      disconnect(all ? `user:${session.id}` : `session:${session.sid}`);
    }
  };
}
