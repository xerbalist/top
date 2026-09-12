// Ephemeral P-256 ECDH + HKDF-SHA256 + AES-256-GCM.
// The fingerprint MUST be compared with the peer over an independent channel.
// A relay-delivered public key alone does not authenticate the other endpoint.
const utf8 = new TextEncoder();
const base64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unbase64 = text => Uint8Array.from(atob(text),c=>c.charCodeAt(0));
export class EncryptedChat {
  constructor(gameId, selfId, peerId) {
    this.gameId=gameId; this.selfId=selfId; this.peerId=peerId;
    this.generation=0; this.verified=false; this.keys=null; this.sequence=0; this.received=new Map();
  }
  async init() {
    if(this.publicKey)return this.publicKey;
    const generation=this.generation;
    const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);
    const pub=base64(await crypto.subtle.exportKey('raw',pair.publicKey));
    if(generation!==this.generation)throw new Error('Sesija je zatvorena.');
    this.pair=pair;this.publicKey=pub;return pub;
  }
  async acceptPeer(publicKey) {
    if(typeof publicKey!=='string'||publicKey.length!==88)throw new Error('Neispravan ključ.');
    if(this.peerKey===publicKey&&this.keys)return false;
    this.verified=false;this.keys=null;
    const generation=++this.generation;
    const raw=unbase64(publicKey);
    if(raw.length!==65)throw new Error('Neispravan ključ.');
    const key=await crypto.subtle.importKey('raw',raw,{name:'ECDH',namedCurve:'P-256'},false,[]);
    const shared=await crypto.subtle.deriveBits({name:'ECDH',public:key},this.pair.privateKey,256);
    const participants=[[this.selfId,this.publicKey],[this.peerId,publicKey]].sort((a,b)=>a[0].localeCompare(b[0]));
    const context=JSON.stringify(['TOP-chat-v1',this.gameId,participants]);
    const digest=await crypto.subtle.digest('SHA-256',utf8.encode(context));
    const material=await crypto.subtle.importKey('raw',shared,'HKDF',false,['deriveKey']);
    new Uint8Array(shared).fill(0);
    const keys={};
    for(const [id] of participants) keys[id]=await crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:digest,info:utf8.encode('sender:'+id)},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
    if(generation!==this.generation)return false;
    this.keys=keys;this.peerKey=publicKey;this.sequence=0;this.received.clear();
    this.channel=base64(digest);
    this.fingerprint=Array.from(new Uint8Array(digest).slice(0,12),b=>b.toString(16).padStart(2,'0')).join('').match(/.{4}/g).join(' ');
    return true;
  }
  confirm() { if(!this.keys)throw new Error('Ključevi nisu spremni.');this.verified=true; }
  async encrypt(text) {
    if(!this.verified||!this.keys)throw new Error('Prvo uporedi i potvrdi sigurnosni kod sa sagovornikom.');
    if(typeof text!=='string'||!text.trim()||text.length>1000)throw new Error('Poruka mora imati 1–1000 znakova.');
    const sequence=++this.sequence, iv=crypto.getRandomValues(new Uint8Array(12));
    const aad=utf8.encode(JSON.stringify([this.gameId,this.channel,this.selfId,sequence]));
    const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},this.keys[this.selfId],utf8.encode(text));
    return {channel:this.channel,sequence,iv:base64(iv),ciphertext:base64(ciphertext)};
  }
  async decrypt(envelope,sender) {
    if(!this.verified||!this.keys||!envelope||envelope.channel!==this.channel||![this.selfId,this.peerId].includes(sender))throw new Error('Nepotvrđena sesija.');
    const {sequence,iv,ciphertext}=envelope;
    if(!Number.isSafeInteger(sequence)||sequence<1||sequence<=(this.received.get(sender)||0)||typeof ciphertext!=='string'||ciphertext.length>5500||typeof iv!=='string'||iv.length!==16)throw new Error('Neispravna ili ponovljena poruka.');
    const aad=utf8.encode(JSON.stringify([this.gameId,this.channel,sender,sequence]));
    const data=await crypto.subtle.decrypt({name:'AES-GCM',iv:unbase64(iv),additionalData:aad},this.keys[sender],unbase64(ciphertext));
    if(sequence<=(this.received.get(sender)||0))throw new Error('Ponovljena poruka.');
    const text=new TextDecoder('utf-8',{fatal:true}).decode(data);
    if(text.length>1000)throw new Error('Preduga poruka.');
    this.received.set(sender,sequence);return text;
  }
  clear() {
    this.generation++;this.pair=null;this.keys=null;this.publicKey=null;this.peerKey=null;
    this.channel=null;this.fingerprint=null;this.verified=false;this.received.clear();this.sequence=0;
  }
}
