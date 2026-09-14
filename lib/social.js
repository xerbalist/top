export function parseStatusMedia(input) {
  if ((input.image != null && typeof input.image !== 'string') || (input.link != null && typeof input.link !== 'string')) throw new Error('Neispravan prilog.');
  const image = typeof input.image === 'string' ? input.image : '';
  const link = typeof input.link === 'string' ? input.link.trim() : '';
  if (image) {
    const match = image.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match) throw new Error('Slika mora biti PNG, JPEG ili WebP.');
    const bytes = Buffer.from(match[2],'base64');
    if (bytes.length > 1048576 || bytes.toString('base64') !== match[2]) throw new Error('Slika sme imati najviše 1 MB.');
    const valid = match[1] === 'png' ? bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))
      : match[1] === 'jpeg' ? bytes[0]===255 && bytes[1]===216 && bytes[2]===255
      : bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP';
    if (!valid) throw new Error('Format slike nije ispravan.');
  }
  if (link) {
    let url;try {url=new URL(link);}catch {throw new Error('Unesi ispravan HTTP ili HTTPS link.');}
    if (link.length>2048 || !['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error('Link nije dozvoljen.');
  }
  return {image,link};
}

// Retweets never broaden the original audience: only author and accepted friends.
export const statusAudience = `NOT u.blocked AND (s.user_id=$1 OR EXISTS (
  SELECT 1 FROM friendships f WHERE ((f.requester=$1 AND f.addressee=s.user_id) OR (f.addressee=$1 AND f.requester=s.user_id)) AND f.status='accepted'))
  AND NOT EXISTS (SELECT 1 FROM friendships f WHERE ((f.requester=$1 AND f.addressee=s.user_id) OR (f.addressee=$1 AND f.requester=s.user_id)) AND f.status='blocked')`;

export function installSocial(app,{auth,q,canSeeStatus,limiter}) {
  app.post('/api/statuses',auth,async(req,res)=>{
    if(!limiter.take('status-post:'+req.user.id,10,60000))return res.status(429).json({error:'Sačekaj pre nove objave.'});
    const body=String(req.body.body||'').trim();
    let media;try {media=parseStatusMedia(req.body);}catch(error){return res.status(400).json({error:error.message});}
    if(body.length>280 || (!body&&!media.image&&!media.link))return res.status(400).json({error:'Unesi tekst, sliku ili link. Tekst može imati do 280 karaktera.'});
    const result=await q('INSERT INTO statuses(user_id,body,image_data,link_url) VALUES($1,$2,$3,$4) RETURNING id,body,created_at',[req.user.id,body,media.image,media.link]);
    res.status(201).json(result.rows[0]);
  });
  app.get('/api/statuses/:id/image',auth,canSeeStatus,async(req,res)=>{
    const result=await q('SELECT image_data FROM statuses WHERE id=$1',[req.params.id]);
    const match=result.rows[0]?.image_data.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
    if(!match)return res.status(404).end();
    res.type(match[1]).send(Buffer.from(match[2],'base64'));
  });
  app.post('/api/statuses/:id/repost',auth,canSeeStatus,async(req,res)=>{
    const deleted=await q('DELETE FROM status_reposts WHERE status_id=$1 AND user_id=$2 RETURNING status_id',[req.params.id,req.user.id]);
    if(!deleted.rows[0])await q('INSERT INTO status_reposts(status_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[req.params.id,req.user.id]);
    res.json({reposted:!deleted.rows[0]});
  });
  app.get('/api/feed',auth,async(req,res)=>{
    const filter=['likes','reposts'].includes(req.query.filter)?req.query.filter:'all';
    const offset=Math.max(0,Math.min(100000,parseInt(req.query.offset,10)||0));
    const result=await q(`SELECT s.id,s.body,s.created_at,s.link_url,(s.image_data<>'') AS has_image,u.username,
      (SELECT count(*) FROM status_likes l WHERE l.status_id=s.id) likes,
      (SELECT count(*) FROM status_reposts r WHERE r.status_id=s.id) reposts,
      EXISTS(SELECT 1 FROM status_likes l WHERE l.status_id=s.id AND l.user_id=$1) liked,
      EXISTS(SELECT 1 FROM status_reposts r WHERE r.status_id=s.id AND r.user_id=$1) reposted
      FROM statuses s JOIN users u ON u.id=s.user_id WHERE ${statusAudience}
      AND ($2='all' OR ($2='likes' AND EXISTS(SELECT 1 FROM status_likes l WHERE l.status_id=s.id AND l.user_id=$1))
      OR ($2='reposts' AND EXISTS(SELECT 1 FROM status_reposts r WHERE r.status_id=s.id AND r.user_id=$1)))
      ORDER BY GREATEST(s.created_at,COALESCE((SELECT max(r.created_at) FROM status_reposts r JOIN users ru ON ru.id=r.user_id
        WHERE r.status_id=s.id AND NOT ru.blocked AND (r.user_id=$1 OR EXISTS(SELECT 1 FROM friendships f
        WHERE ((f.requester=$1 AND f.addressee=r.user_id) OR (f.addressee=$1 AND f.requester=r.user_id)) AND f.status='accepted'))
        AND NOT EXISTS(SELECT 1 FROM friendships f WHERE ((f.requester=$1 AND f.addressee=r.user_id) OR (f.addressee=$1 AND f.requester=r.user_id)) AND f.status='blocked')),s.created_at)) DESC,s.id DESC LIMIT 25 OFFSET $3`,[req.user.id,filter,offset]);
    res.json(result.rows);
  });
}
