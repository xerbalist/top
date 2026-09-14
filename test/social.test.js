import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStatusMedia} from '../lib/social.js';

test('status media allows HTTP links and bounded raster data; rejects active content and spoofed formats',()=>{
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=';
  assert.equal(parseStatusMedia({image:png,link:'https://youtu.be/abcdefghijk'}).image,png);
  for(const link of ['javascript:alert(1)','data:text/html,hi','https://user:pass@example.com','not a URL'])assert.throws(()=>parseStatusMedia({link}));
  for(const image of ['data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,aGVsbG8='])assert.throws(()=>parseStatusMedia({image}));
  const bytes=Buffer.alloc(1048577);Buffer.from('89504e470d0a1a0a','hex').copy(bytes);
  assert.throws(()=>parseStatusMedia({image:'data:image/png;base64,'+bytes.toString('base64')}));
  assert.equal(parseStatusMedia({image:'data:image/png;base64,'+bytes.subarray(0,1048576).toString('base64')}).image.length>1048576,true);
});
