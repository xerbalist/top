import bcrypt from 'bcryptjs';

// UUIDs, never usernames: deleting/re-registering a name cannot grant privileges.
export const isAdmin = id => String(process.env.ADMIN_USER_IDS || '').split(',').some(value => value.trim().toLowerCase() === id);

export function installAdmin(app, { auth, q, sessions, stopGames, limiter }) {
  const admin = (req, res, next) => {
    if (!isAdmin(req.user.id)) return res.status(403).json({error:'Pristup je dozvoljen samo administratoru.'});
    next();
  };
  app.get('/api/admin/users', auth, admin, async (req, res) => {
    const search = String(req.query.q || '').trim().slice(0,24);
    const page = Math.max(0, Math.min(100000, Number.parseInt(req.query.page,10) || 0));
    const result = await q(`SELECT id,username,created_at,blocked FROM users
      WHERE strpos(lower(username),lower($1))>0 ORDER BY created_at DESC,id LIMIT 26 OFFSET $2`, [search,page*25]);
    res.json({users:result.rows.slice(0,25).map(user=>({...user,isAdmin:isAdmin(user.id)})),hasMore:result.rows.length>25,page});
  });
  app.post('/api/admin/users/:id/moderate', auth, admin, async (req, res) => {
    if (!limiter.take('admin:'+req.user.id,10,15*60000)) return res.status(429).json({error:'Previše pokušaja. Sačekaj 15 minuta.'});
    const { action, password, username } = req.body;
    const id = req.params.id;
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id) || !['block','unblock','delete'].includes(action)) return res.status(400).json({error:'Neispravna akcija.'});
    if (id === req.user.id || isAdmin(id.toLowerCase())) return res.status(403).json({error:'Administratorski nalozi su zaštićeni od blokiranja i brisanja.'});
    const current = await q('SELECT password_hash FROM users WHERE id=$1 AND NOT blocked',[req.user.id]);
    if (typeof password !== 'string' || Buffer.byteLength(password)>72 || !current.rows[0] || !await bcrypt.compare(password,current.rows[0].password_hash)) return res.status(403).json({error:'Administratorska lozinka nije ispravna.'});
    let result;
    if (action === 'delete') {
      // Exact name confirmation and immutable ID both required.
      result = await q('DELETE FROM users WHERE id=$1 AND username=$2 RETURNING id',[id,typeof username==='string'?username:'']);
    } else {
      result = await q('UPDATE users SET blocked=$1,auth_version=auth_version+1 WHERE id=$2 RETURNING id',[action==='block',id]);
    }
    if (!result.rows[0]) return res.status(404).json({error:'Nalog nije pronađen ili ime za potvrdu nije tačno.'});
    stopGames(id);
    await sessions.revoke({kind:'user',id},true);
    res.json({ok:true});
  });
}
