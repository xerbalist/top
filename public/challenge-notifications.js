export function createChallengeNotifications({api,openGame}) {
  const pending=new Map(), dismissed=new Set();
  let box=null, busy=false, current=null, generation=0;
  function remove(id) {
    pending.delete(id);
    dismissed.add(id);
    if(dismissed.size>200)dismissed.delete(dismissed.values().next().value);
    render();
  }
  function render() {
    if(busy)return;
    box?.remove();box=null;
    for(const [id,c] of pending)if(Date.parse(c.expires_at)<=Date.now())pending.delete(id);
    current=pending.values().next().value;
    if(!current)return;
    const challenge=current;
    box=document.createElement('aside');
    box.className='challenge-notification';
    box.setAttribute('aria-label','Poziv za partiju');
    box.innerHTML=`<div class="challenge-notification-heading"><span>Novi izazov</span><button type="button" data-close aria-label="Sakrij obaveštenje">×</button></div>
      <p aria-live="polite"><b data-name></b> te izaziva na partiju.</p>
      <small>Bez vremenskog ograničenja</small>
      <div class="row"><button class="primary" data-accept>Prihvati</button><button data-decline>Odbij</button></div>
      <p data-error role="status"></p><small data-count></small>`;
    box.querySelector('[data-name]').textContent=challenge.challenger;
    box.querySelector('[data-count]').textContent=pending.size>1?`Još izazova: ${pending.size-1}`:'';
    box.querySelector('[data-close]').onclick=()=>remove(challenge.id);
    async function respond(status) {
      if(busy)return;
      const version=generation, element=box;
      busy=true;element.querySelectorAll('button').forEach(button=>button.disabled=true);
      try {
        const result=await api(`/challenges/${challenge.id}/respond`,{method:'POST',body:JSON.stringify({status})});
        if(version!==generation)return;
        pending.delete(challenge.id);dismissed.add(challenge.id);
        if(result.gameId)openGame(result.gameId);
      } catch(error) {
        if(version!==generation)return;
        element.querySelector('[data-error]').textContent=error.message;
        element.querySelectorAll('button').forEach(button=>button.disabled=false);
        busy=false;return;
      } finally {if(version===generation)busy=false;}
      if(version===generation)render();
    }
    box.querySelector('[data-accept]').onclick=()=>respond('accepted');
    box.querySelector('[data-decline]').onclick=()=>respond('declined');
    document.body.appendChild(box);
  }
  return {
    add(challenge) {
      if(!challenge || typeof challenge.id!=='string' || typeof challenge.challenger!=='string' || !Number.isFinite(Date.parse(challenge.expires_at)))return;
      if(dismissed.has(challenge.id)||pending.has(challenge.id)||pending.size>=50)return;
      pending.set(challenge.id,challenge);render();
    },
    remove,
    clear() {generation++;pending.clear();dismissed.clear();busy=false;current=null;box?.remove();box=null;}
  };
}
