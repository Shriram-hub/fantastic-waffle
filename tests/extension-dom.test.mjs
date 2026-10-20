import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {fillApplication,buildAnswers} from '../extension/autofill.mjs';
import {extractLinkedInProfile} from '../extension/linkedin.mjs';
import {MasterProfileSchema} from '../server/services/candidate-profile.mjs';

function browser(t,html,url='https://jobs.example.test/apply') {const dom=new JSDOM(html,{url,runScripts:'outside-only'});t.after(()=>dom.window.close());return dom.window;}
async function fill(w,master,resume=null,options={}) {w.savedAnswers=buildAnswers({master});w.savedResume=resume;w.savedOptions=options;return w.eval(`(${fillApplication.toString()})(savedAnswers,savedResume,savedOptions)`);}
test('serialized autofill uses native events, open shadows, precise choices and explicit screening answers',async t=>{
  const w=browser(t,'<form><label>Full name<input id="full"></label><label>First name<input id="first"></label><label>Country<select id="country"><option value="">Select</option><option value="IN">India</option></select></label><label>Available start date<input id="available" type="date"></label><fieldset><legend>Will you now or in the future require visa sponsorship?</legend><label><input type="radio" name="visa" value="yes">Yes</label><label><input type="radio" name="visa" value="no">No</label></fieldset><label><input type="checkbox" id="consent" required>I agree to terms</label><label>Unspecified legal question<input required id="unknown"></label><button type="submit">Submit</button></form><div id="shadow"></div>');
  const root=w.document.getElementById('shadow').attachShadow({mode:'open'});root.innerHTML='<label>Email<input id="mail"></label>';
  const master=MasterProfileSchema.parse({personal:{fullName:'Casey Quinn',firstName:'Casey',email:'casey@example.test',country:'India'},applicationDefaults:{requiresVisaSponsorship:false,earliestStartDate:'2027-01-02'}});
  const events=[];for(const name of ['input','change','blur'])w.document.getElementById('full').addEventListener(name,()=>events.push(name));
  let submits=0;w.document.querySelector('form').addEventListener('submit',()=>submits++);
  const result=await fill(w,master);
  assert.equal(w.document.getElementById('full').value,'Casey Quinn');assert.equal(root.querySelector('input').value,'casey@example.test');assert.deepEqual(events,['input','change','blur']);
  assert.equal(w.document.getElementById('country').value,'IN');assert.equal(w.document.getElementById('available').value,'2027-01-02');
  assert.equal(w.document.querySelector('[value="no"]').checked,true);assert.equal(w.document.querySelector('[value="yes"]').checked,false);assert.equal(w.document.getElementById('consent').checked,false);assert.equal(w.document.getElementById('unknown').value,'');assert.equal(submits,0);assert.ok(result.missing.length);
});
test('work history adds observed sections sequentially and maps month/year dropdowns without global name leakage',async t=>{
  const row='<fieldset class="experience-entry"><legend>Work Experience</legend><label>Company name<input></label><label>Job title<input></label><label>Start month<select><option value="">Month</option><option value="june">June</option><option value="jan">Jan</option></select></label><label>Start year<input></label><label>I currently work here<input type="checkbox"></label></fieldset>';
  const w=browser(t,`<section id="history">${row}<button id="add" type="button">+ Add Work Experience</button></section>`);
  w.document.getElementById('add').addEventListener('click',()=>setTimeout(()=>w.document.getElementById('add').insertAdjacentHTML('beforebegin',row),10));
  const master=MasterProfileSchema.parse({personal:{fullName:'Casey Quinn'},workExperience:[{company:'Acme',title:'Analyst',startMonth:'06',startYear:'2023',isCurrentRole:true},{company:'Beta',title:'Associate',startMonth:'01',startYear:'2021',isCurrentRole:false}]});
  const result=await fill(w,master,null,{addRepeating:true}),rows=w.document.querySelectorAll('fieldset');
  assert.equal(result.added,1);assert.equal(rows.length,2);assert.equal(rows[0].querySelector('input').value,'Acme');assert.equal(rows[1].querySelector('input').value,'Beta');assert.equal(rows[0].querySelector('select').value,'june');assert.equal(rows[0].querySelector('[type="checkbox"]').checked,true);
});
test('resume attachment transfers original bytes and refuses an incompatible file accept list',async t=>{
  const w=browser(t,'<label>Resume<input type="file" accept=".pdf"></label><label>CV<input id="wrong" type="file" accept=".docx"></label>');
  w.DataTransfer=class{constructor(){this.files=[];this.items={add:file=>this.files.push(file)};}};
  for(const input of w.document.querySelectorAll('input')){let files=[];Object.defineProperty(input,'files',{get:()=>files,set:value=>{files=value;}});}
  const result=await fill(w,MasterProfileSchema.parse({}),{name:'resume.pdf',base64:Buffer.from('%PDF-test-original').toString('base64')});
  assert.equal(w.document.querySelector('input').files[0].name,'resume.pdf');assert.equal(w.document.querySelector('input').files[0].type,'application/pdf');assert.equal(w.document.getElementById('wrong').files.length,0);assert.equal(result.filled,1);assert.ok(result.missing.some(s=>s.includes('accepted format')));
});
test('LinkedIn sync reads only the active profile sections and preserves their text for structured extraction',t=>{
  const w=browser(t,'<section><h1>Casey Quinn</h1><div class="text-body-medium">Financial Analyst</div></section><section><div id="experience"></div><h2>Experience</h2><p>Acme</p><p>Analyst</p><p>2023 – Present</p></section><aside>Unrelated profile recommendations</aside>','https://www.linkedin.com/in/casey/');
  const result=w.eval(`(${extractLinkedInProfile.toString()})()`);assert.equal(result.profile.personal.fullName,'Casey Quinn');assert.match(result.text,/Acme/);assert.ok(!result.text.includes('Unrelated profile recommendations'));
});
test('country codes cannot answer authorization for a different country and negated questions remain blank',async t=>{
  const w=browser(t,'<label>Are you legally authorized to work in the United States?<input id="us"></label><label>Are you legally authorized to work in India?<input id="in"></label><label>Can you work without visa sponsorship?<input id="negative"></label><label>Country<select id="country"><option value="choose">Please select</option><option value="IN">India</option></select></label>');
  await fill(w,MasterProfileSchema.parse({personal:{country:'India'},applicationDefaults:{workAuthorizationCountry:'IN',requiresVisaSponsorship:false}}));
  assert.equal(w.document.getElementById('us').value,'');assert.equal(w.document.getElementById('in').value,'Yes');assert.equal(w.document.getElementById('negative').value,'');assert.equal(w.document.getElementById('country').value,'IN');
});
test('education fields and a custom ARIA combobox fill while a manually entered answer is preserved',async t=>{
  const w=browser(t,'<fieldset><legend>Education</legend><label>School<input id="school"></label><label>Degree<input id="degree"></label><label>Field of study<input id="field"></label></fieldset><label>Email<input id="email" value="manual@example.test"></label><div role="combobox" aria-label="Country" aria-controls="countries" id="combo"></div><div id="countries" role="listbox"></div>');
  let selected='';w.document.getElementById('combo').addEventListener('click',()=>{const o=w.document.createElement('div');o.setAttribute('role','option');o.textContent='India';o.addEventListener('click',()=>{selected='India';});w.document.getElementById('countries').append(o);});
  await fill(w,MasterProfileSchema.parse({personal:{email:'saved@example.test',country:'India'},education:[{institution:'Example University',degree:'B.Com',fieldOfStudy:'Accounting'}]}));
  assert.equal(w.document.getElementById('school').value,'Example University');assert.equal(w.document.getElementById('degree').value,'B.Com');assert.equal(w.document.getElementById('field').value,'Accounting');assert.equal(w.document.getElementById('email').value,'manual@example.test');assert.equal(selected,'India');
});
test('repeating sections retain their context across nested open shadow roots and framework input IDs',async t=>{
  const w=browser(t,'<input id="applicant-firstName-input"><fieldset class="experience-entry"><legend>Work Experience</legend><div id="component"></div></fieldset>');
  const root=w.document.getElementById('component').attachShadow({mode:'open'});root.innerHTML='<label>Company name<input></label><label>Job title<input></label>';
  await fill(w,MasterProfileSchema.parse({personal:{firstName:'Casey'},workExperience:[{company:'Acme',title:'Analyst'}]}));
  assert.equal(w.document.querySelector('input').value,'Casey');assert.equal(root.querySelectorAll('input')[0].value,'Acme');assert.equal(root.querySelectorAll('input')[1].value,'Analyst');
});
