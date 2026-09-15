import test from 'node:test';
import assert from 'node:assert/strict';
import {publicIPv4,previewURL,extractMetadata,youtubeThumbnail,linkPreview} from '../lib/link-preview.js';
test('previews reject private, loopback, metadata, encoded IPs and unsafe protocols',async()=>{
 for(const ip of ['127.0.0.1','10.1.1.1','169.254.169.254','172.20.1.1','192.168.0.1','100.100.100.200','224.1.1.1','::1'])assert.equal(publicIPv4(ip),false);
 assert.equal(publicIPv4('8.8.8.8'),true);
 for(const url of ['http://127.1','http://2130706433','http://0x7f000001','http://[::1]','http://[::ffff:127.0.0.1]','file:///etc/passwd','https://user:pass@example.com','http://example.com:8080'])assert.throws(()=>previewURL(url));
 assert.deepEqual(await linkPreview('http://169.254.169.254/latest/meta-data'),{});
});
test('metadata extracts relative images, reordered attributes and encoded titles',()=>{
 const result=extractMetadata(`<title>Fallback</title><meta content="Chess &amp; friends" property="og:title"><meta name='description' content='A game'><meta property="og:image" content="/cover.jpg">`,'https://example.com/page');
 assert.deepEqual(result,{title:'Chess & friends',description:'A game',imageURL:'https://example.com/cover.jpg'});
 assert.equal(extractMetadata('<title>No image</title>','https://example.com').imageURL,'');
});
test('YouTube thumbnails only use exact hosts and valid video IDs',()=>{
 for(const url of ['https://youtu.be/dQw4w9WgXcQ','https://www.youtube.com/watch?v=dQw4w9WgXcQ','https://youtube.com/shorts/dQw4w9WgXcQ'])assert.equal(youtubeThumbnail(url),'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
 assert.equal(youtubeThumbnail('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ'),'');
 assert.equal(youtubeThumbnail('https://youtu.be/bad'),'');
});

test('download pins DNS and refuses redirects into private networks',async()=>{
 const {download}=await import('../lib/link-preview.js');
 const {EventEmitter}=await import('node:events');
 let requests=0;
 const transport={resolve4:async()=>['8.8.8.8'],https:{get(url,options,callback){
  requests++;
  options.lookup('example.com',{all:true},(error,addresses)=>assert.deepEqual(addresses,[{address:'8.8.8.8',family:4}]));
  const req=new EventEmitter();req.destroy=error=>req.emit('error',error);
  queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=302;res.headers={location:'http://127.0.0.1/admin'};res.resume=()=>{};callback(res);req.emit('close');});
  return req;
 }}};
 await assert.rejects(download('https://example.com',Date.now()+1000,1000,0,transport),/Private address/);
 assert.equal(requests,1);
 transport.resolve4=async()=>['8.8.8.8','10.0.0.1'];
 await assert.rejects(download('https://example.com',Date.now()+1000,1000,0,transport),/Private DNS/);
 assert.equal(requests,1);
});
