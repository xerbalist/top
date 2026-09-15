import http from 'node:http';
import https from 'node:https';
import {resolve4} from 'node:dns/promises';
import {isIP,BlockList} from 'node:net';
const blocked=new BlockList();
for(const [ip,bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])blocked.addSubnet(ip,bits);
export const publicIPv4=ip=>isIP(ip)===4&&!blocked.check(ip);
export function previewURL(value){
 const url=new URL(value);
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port||url.href.length>2048)throw Error('Unsupported URL');
 if(url.hostname.includes(':')||(isIP(url.hostname)&&!publicIPv4(url.hostname)))throw Error('Private address');
 return url;
}
export async function download(value,deadline,limit=1048576,hops=0,transport={resolve4,http,https}){
 if(hops>3||Date.now()>=deadline)throw Error('Preview timeout');
 const url=previewURL(value);
 // Resolve once, validate every answer, then pin the connection to that IP.
 const ips=await Promise.race([isIP(url.hostname)?Promise.resolve([url.hostname]):transport.resolve4(url.hostname),new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('DNS timeout')),Math.max(1,deadline-Date.now()));t.unref();})]);
 if(!ips.length||!ips.every(publicIPv4))throw Error('Private DNS answer');
 const result=await new Promise((resolve,reject)=>{
  const request=(url.protocol==='https:'?transport.https:transport.http).get(url,{agent:false,family:4,lookup:(_host,options,cb)=>cb(null,options.all?[{address:ips[0],family:4}]:ips[0],4),headers:{'User-Agent':'TOP-LinkPreview/1.0','Accept-Encoding':'identity','Accept':'text/html,image/png,image/jpeg,image/webp'}},response=>{
   if([301,302,303,307,308].includes(response.statusCode)){response.resume();resolve({redirect:response.headers.location});return;}
   if(response.statusCode!==200){response.resume();reject(Error('Unavailable'));return;}
   let size=0;const chunks=[];
   response.on('data',chunk=>{size+=chunk.length;if(size>limit)request.destroy(Error('Preview too large'));else chunks.push(chunk);});
   response.on('end',()=>resolve({type:String(response.headers['content-type']||''),bytes:Buffer.concat(chunks),url:url.href}));
   response.on('error',reject);
  });
  const timer=setTimeout(()=>request.destroy(Error('Preview timeout')),Math.max(1,deadline-Date.now()));timer.unref();
  request.on('close',()=>clearTimeout(timer));request.on('error',reject);
 });
 if(result.redirect)return download(new URL(result.redirect,url).href,deadline,limit,hops+1,transport);
 return result;
}
const decode=s=>String(s||'').replace(/&(?:amp|quot|apos|lt|gt|#39|#x[0-9a-f]+|#[0-9]+);/gi,entity=>{
 const known={'&amp;':'&','&quot;':'"','&apos;':"'",'&#39;':"'",'&lt;':'<','&gt;':'>'};if(known[entity])return known[entity];
 const n=entity[2].toLowerCase()==='x'?parseInt(entity.slice(3),16):parseInt(entity.slice(2),10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';
}).replace(/\s+/g,' ').trim();
export function extractMetadata(html,base){
 const fields={};
 for(const tag of html.match(/<meta\b[^>]{0,8192}>/gi)||[]){
  const attrs={};for(const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))attrs[m[1].toLowerCase()]=decode(m[2]??m[3]??m[4]);
  if(attrs.content)fields[(attrs.property||attrs.name||'').toLowerCase()]=attrs.content;
 }
 let image='';try{image=new URL(fields['og:image']||fields['twitter:image'],base).href;if(!fields['og:image']&&!fields['twitter:image'])image='';}catch{}
 return {title:decode(fields['og:title']||fields['twitter:title']||html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]).slice(0,200),description:decode(fields['og:description']||fields.description).slice(0,300),imageURL:image};
}
export function youtubeThumbnail(value){
 const u=new URL(value);if(!['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(u.hostname))return '';
 const id=u.hostname==='youtu.be'?u.pathname.split('/')[1]:u.searchParams.get('v')||u.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1];
 return /^[\w-]{11}$/.test(id||'')?`https://i.ytimg.com/vi/${id}/hqdefault.jpg`:'';
}
const cache=new Map();let active=0;
export async function linkPreview(value){
 let url;try{url=previewURL(value);}catch{return {};}
 const hit=cache.get(url.href);if(hit&&hit.until>Date.now())return hit.value;
 if(active>=4)return {};active++;
 const result={title:url.hostname,description:'',image:''};
 try{
  const deadline=Date.now()+6000;
  let imageURL=youtubeThumbnail(url.href);
  if(!imageURL){const page=await download(url.href,deadline);if(!page.type.includes('text/html'))throw Error('Not HTML');const meta=extractMetadata(page.bytes.toString('utf8'),page.url);result.title=meta.title||result.title;result.description=meta.description;imageURL=meta.imageURL;}
  else result.title='YouTube video';
  if(imageURL){const image=await download(imageURL,deadline,262144);const b=image.bytes;
   const type=b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))?'image/png':b[0]===255&&b[1]===216&&b[2]===255?'image/jpeg':b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP'?'image/webp':null;
   if(type)result.image=`data:${type};base64,${b.toString('base64')}`;
  }
 }catch{/* Missing metadata never prevents posting the link. */}
 finally{active--;}
 if(cache.size>=100)cache.delete(cache.keys().next().value);
 cache.set(url.href,{value:result,until:Date.now()+(result.image?600000:30000)});return result;
}
