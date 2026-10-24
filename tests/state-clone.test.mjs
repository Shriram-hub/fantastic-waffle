import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cloneJsonState} from '../server/state-clone.mjs';

test('workspace snapshots isolate editable JSON containers without duplicating large text across a small worker heap',()=>{
  const original={profile:{skills:['React']},jobs:[{description:'A job description',tags:['Remote']}],resume:null};
  const copied=cloneJsonState(original);copied.profile.skills.push('SQL');copied.jobs[0].tags[0]='Hybrid';
  assert.deepEqual(original.profile.skills,['React']);assert.equal(original.jobs[0].tags[0],'Remote');assert.equal(copied.resume,null);
  const moduleUrl=new URL('../server/state-clone.mjs',import.meta.url).href;
  const result=execFileSync(process.execPath,['--max-old-space-size=64','--input-type=module','-e',`
    import assert from 'node:assert/strict';
    import {cloneJsonState} from ${JSON.stringify(moduleUrl)};
    const state={jobs:Array.from({length:1500},(_,id)=>({id,description:(id+':'+ 'job requirements ').repeat(450),tags:['Remote']})),profile:{skills:['React']}};
    const snapshots=Array.from({length:10},()=>cloneJsonState(state));
    snapshots[0].jobs[0].tags.push('SQL');
    assert.equal(snapshots[1].jobs[0].tags.length,1);
    assert.equal(snapshots[9].jobs[1499].description,state.jobs[1499].description);
    process.stdout.write('isolated');
  `],{encoding:'utf8',timeout:15000});
  assert.equal(result,'isolated');
});
