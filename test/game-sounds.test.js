import test from 'node:test';
import assert from 'node:assert/strict';
import { watchGameSounds } from '../public/game-sounds.js';

test('sound events deduplicate HTTP/socket updates and selection renders', () => {
  const played=[];
  const update=watchGameSounds({history:[]}, cue=>played.push(cue));
  update({history:[]});
  update({history:['e4']});
  update({history:['e4']});
  update({history:[]}); // stale HTTP response
  update({history:['e4']});
  update({history:['e4','d5','exd5']});
  update({history:['e4','d5','exd5','Qxd5+'],inCheck:true});
  update({history:['e4','d5','exd5','Qxd5+'],gameOver:true});
  update({history:['e4','d5','exd5','Qxd5+'],gameOver:true});
  assert.deepEqual(played,['move','capture','check','end']);
});

test('opening an existing game is silent; castle and promotion have cues',()=>{
  const played=[];
  const update=watchGameSounds({history:['e4']},cue=>played.push(cue));
  update({history:['e4']});
  update({history:['e4','O-O']});
  update({history:['e4','O-O','e8=Q']});
  assert.deepEqual(played,['castle','promotion']);
});
