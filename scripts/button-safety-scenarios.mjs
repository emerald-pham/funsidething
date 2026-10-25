// Full-app scenarios use native DOM events and read-only state/storage observations.
const base=board=>{
 board.tasks=board.tasks.slice(0,8);board.passStartedAt=Date.now();board.settings.showPostpone=true;
 board.contexts=[{id:'gate-context',name:'Gate context',active:true}];board.tasks[0].ctx=['gate-context'];
};
export async function runButtonScenarios(h){
 await h.scenario('populated Add contexts settings and list', {decorate:base},async ui=>{
  await ui.act('toggle-add',()=>document.getElementById('addToggle').getAttribute('aria-expanded')==='false');
  await ui.act('toggle-add',()=>document.getElementById('addToggle').getAttribute('aria-expanded')==='true');
  await ui.fill('#addStart','2026-10-01');await ui.click('#addStartClear',()=>document.getElementById('addStart').value==='','Clear Add start date');
  await ui.fill('#addDue','2026-10-02');await ui.click('#addDueClear',()=>document.getElementById('addDue').value==='','Clear Add due date');
  await ui.act('qctx',()=>document.querySelector('[data-act="qctx"]').getAttribute('aria-pressed')==='true');
  await ui.select('#addPrerequisite','synthetic-populated-1');
  await ui.act('add-dependency',()=>document.querySelectorAll('#addDependencies select').length===2,'#addDependencies [data-act="add-dependency"]');
  await ui.act('remove-dependency',()=>document.querySelectorAll('#addDependencies select').length===1,'#addDependencies [data-act="remove-dependency"]').catch(error=>{throw Error('Add dependency remove: '+error.message);});
  await ui.select('#addPrerequisite','');await ui.fill('#addInput','Gate accepted new task');
  await ui.act('add',()=>state.tasks.some(t=>t.title==='Gate accepted new task')&&document.getElementById('addInput').value==='');
  await ui.act('toggle-ctx',()=>state.ctxOpen===false);await ui.act('toggle-ctx',()=>state.ctxOpen===true);
  await ui.act('cycle-context',()=>state.contexts[0].excluded===true);
  await ui.act('cycle-context',()=>state.contexts[0].active===true&&!state.contexts[0].excluded);
  await ui.act('toggle-no-context',()=>document.querySelector('[data-act="toggle-no-context"]').classList.contains('excluded'));
  await ui.act('toggle-no-context',()=>!document.querySelector('[data-act="toggle-no-context"]').classList.contains('excluded'));
  await ui.act('add-ctx',()=>state.contexts.some(c=>c.name==='Safety gate context'));
  await ui.act('settings',()=>!!document.querySelector('#stHorizon'));
  await ui.fill('#newCtxName','Gate named context');await ui.act('add-ctx-named',()=>state.contexts.some(c=>c.name==='Gate named context'));
  await ui.act('del-ctx',()=>!state.contexts.some(c=>c.id==='gate-context'),'[data-act="del-ctx"][data-id="gate-context"]');
  await ui.fill('#stHorizon','77');await ui.act('save-settings',()=>state.settings.horizonMin===77&&!document.querySelector('#stHorizon'));
  await ui.act('toggle-list',()=>document.getElementById('listBody').getClientRects().length>0);
  await ui.act('list-tag',()=>document.querySelector('[data-act="list-tag"]').getAttribute('aria-pressed')==='true');
  await ui.act('list-eligibility',()=>document.querySelector('[data-act="list-eligibility"][data-id="eligible"]').getAttribute('aria-pressed')==='true','[data-act="list-eligibility"][data-id="eligible"]');
  await ui.fill('#listSearch','No matching synthetic title');
  await ui.act('clear-list-filters',()=>document.getElementById('listSearch').value===''&&document.querySelectorAll('#listBody [data-act="edit"]').length>0);
  await ui.act('bulk-select',()=>document.querySelector('[data-act="bulk-select"]').getAttribute('aria-pressed')==='true');
  await ui.act('bulk-toggle',()=>document.querySelector('[data-act="bulk-edit"]').disabled===false);
  await ui.act('bulk-cancel',()=>document.querySelector('[data-act="bulk-select"]').getAttribute('aria-pressed')==='false');
  await ui.act('bulk-select-all',()=>document.querySelector('[data-act="bulk-edit"]').disabled===false);
  await ui.act('bulk-edit',()=>!!document.getElementById('bulkApplyDue'));
  for(const [field,id]of [['url','Url'],['due','Due'],['startsAt','Start'],['ctx','Contexts']])await ui.act('bulk-clear',new Function('return document.getElementById("bulkApply'+id+'").checked&&document.getElementById("bulkStatus'+id+'").textContent.includes("Will clear")'),'[data-act="bulk-clear"][data-field="'+field+'"]');
  await ui.act('bulk-save',()=>!document.getElementById('bulkApplyDue'));
  await ui.act('edit',()=>!!document.getElementById('etTitle'),'#listBody [data-act="edit"]');
  await ui.select('#etPrerequisite','synthetic-populated-1');await ui.act('add-dependency',()=>document.querySelectorAll('#editDependencies select').length===2,'#editDependencies [data-act="add-dependency"]');
  await ui.act('remove-dependency',()=>document.querySelectorAll('#editDependencies select').length===1,'#editDependencies [data-act="remove-dependency"]');await ui.select('#etPrerequisite','');
  await ui.fill('#etTitle','Gate edited title');await ui.fill('#etDue','2026-10-01');await ui.click('#etDueClear',()=>document.getElementById('etDue').value==='','Clear Edit due date');
  await ui.fill('#etStart','2026-10-01');await ui.click('#etStartClear',()=>document.getElementById('etStart').value==='','Clear Edit start date');
  await ui.act('save-edit',()=>state.tasks.some(t=>t.title==='Gate edited title')&&!document.getElementById('etTitle'));
  await ui.act('undo',()=>!state.tasks.some(t=>t.title==='Gate edited title'));
 });
 for(const action of ['done-task','worked-task','dot-task','delete-task'])await h.scenario('editor '+action,{decorate:base},async ui=>{
  await ui.act('toggle-list',()=>document.getElementById('listBody').getClientRects().length>0);
  await ui.act('edit',()=>!!document.getElementById('etTitle'),'#listBody [data-act="edit"][data-id="synthetic-kept"]');
  const expected=action==='done-task'?()=>state.tasks.find(t=>t.id==='synthetic-kept').done===true:action==='worked-task'?()=>!!state.workedAt['synthetic-kept']:action==='dot-task'?()=>state.chain.includes('synthetic-kept'):()=>!state.tasks.some(t=>t.id==='synthetic-kept');
  await ui.act(action,expected);
  if(action==='done-task'){
   await ui.act('toggle-hist',()=>state.histOpen===true);await ui.act('restore',()=>state.tasks.find(t=>t.id==='synthetic-kept').done===false);
   await ui.act('edit',()=>!!document.getElementById('etTitle'),'#listBody [data-act="edit"][data-id="synthetic-kept"]');await ui.act('done-task',()=>state.tasks.find(t=>t.id==='synthetic-kept').done===true);
   await ui.act('settings',()=>!!document.getElementById('stHorizon'));await ui.act('clear-done',()=>!state.tasks.some(t=>t.id==='synthetic-kept'));
  }
  if(action==='worked-task'){
   await ui.act('edit',()=>!!document.getElementById('etTitle'),'#listBody [data-act="edit"][data-id="synthetic-kept"]');await ui.act('return-candidate',()=>!state.workedAt['synthetic-kept']);
  }
 });
 const scanBase=board=>{base(board);board.settings.thresholdPct=0;board.snooze=999;board.contexts=[];for(const task of board.tasks)task.ctx=[];};
 const scannerCases={
  yes:()=>state.chain.includes('synthetic-populated-1'),no:()=>state.considered['synthetic-populated-1']==='no',cant:()=>!!state.cantAt['synthetic-populated-1'],postpone:()=>state.tasks.find(t=>t.id==='synthetic-populated-1').postponeOps.some(op=>op.until>Date.now()),
  'cand-done':()=>state.tasks.find(t=>t.id==='synthetic-populated-1').done===true,'cand-worked':()=>!!state.workedAt['synthetic-populated-1'],
  'bench-done':()=>state.tasks.find(t=>t.id==='synthetic-kept').done===true,'bench-cant':()=>!!state.cantAt['synthetic-kept'],'bench-postpone':()=>state.tasks.find(t=>t.id==='synthetic-kept').postponeOps.some(op=>op.until>Date.now()),
  dislodge:()=>state.considered['synthetic-kept']==='dislodged',worked:()=>!!state.workedAt['synthetic-kept'],'start-working':()=>state.mode==='work'
 };
 for(const [action,expected]of Object.entries(scannerCases))await h.scenario('scanner '+action,{decorate:scanBase},async ui=>{
  await ui.act('start-scan',()=>state.chain[0]==='synthetic-kept'&&state.candidateId==='synthetic-populated-1');await ui.act(action,expected);
  if(action==='yes')await ui.act('reveal',()=>state.listOpen===true&&!!document.querySelector('[data-row="synthetic-kept"]'));
  if(action==='start-working')await ui.act('resume-scan',()=>state.mode==='scan');
 });
 await h.scenario('intervention continue and skipped fresh pass',{decorate:board=>{scanBase(board);board.chain=['synthetic-kept'];board.interventionActive=true;board.candidateId=null;}},async ui=>{
  await ui.act('continue-scan',()=>state.interventionActive===false&&state.mode==='scan');
 });
 await h.scenario('exhausted scanner rescan and new pass',{decorate:board=>{scanBase(board);board.chain=['synthetic-kept'];for(const task of board.tasks.slice(1))board.considered[task.id]='no';}},async ui=>{
  await ui.act('rescan',()=>!Object.values(state.considered).includes('no'));
 });
 await h.scenario('fresh pass',{decorate:board=>{scanBase(board);board.chain=['synthetic-kept'];for(const task of board.tasks.slice(1))board.considered[task.id]='no';}},async ui=>{
  await ui.act('new-pass',()=>Object.keys(state.considered).length===0);
 });
 await h.scenario('overdue WOOP native walkthrough',{decorate:board=>{scanBase(board);for(const task of board.tasks)task.due='2000-01-01';}},async ui=>{
  await ui.act('start-scan',()=>state.candidateId==='synthetic-populated-1');await ui.act('run-woop',()=>!!document.getElementById('woopAnswer'));
  await ui.fill('#woopAnswer','Gate best outcome');await ui.act('woop-next',()=>document.querySelector('[data-act="woop-next"]').dataset.step==='1');
  await ui.fill('#woopAnswer','Gate obstacle');await ui.act('woop-next',()=>document.querySelector('[data-act="woop-next"]').dataset.step==='2');
  await ui.fill('#woopAnswer','If blocked then begin one small action');await ui.act('woop-next',()=>state.tasks.find(t=>t.id==='synthetic-populated-1').woopPlan?.outcome==='Gate best outcome');
 });
 await h.scenario('recorded history and final WOOP',{decorate:board=>{
  scanBase(board);board.tasks=board.tasks.slice(0,1);board.mode='work';board.chain=['synthetic-kept'];board.settings.lastTaskWoop=true;
  board.tasks[0].ratingHistory=Array.from({length:25},(_,i)=>({v:1,id:'gate-observation-'+i,at:Date.now()-100000+i,seq:i+1,kind:i<2?'dislodge':'edit',after:{mu:25,sigma:8.3,likelihood:1,eligible:true,fallback:false,n:1,samples:250,topK:1}}));
 }},async ui=>{
  await ui.act('edit',()=>!!document.getElementById('etTitle'));
  await ui.act('more-rating-history',()=>document.querySelectorAll('#taskRatingHistory .rating-event').length===25);
  await ui.act('close-modal',()=>!document.getElementById('etTitle'));
  await ui.act('woop-start',()=>!!document.getElementById('woopAnswer'));
  await ui.fill('#woopAnswer','Complete the final task');await ui.act('woop-next',()=>document.querySelector('[data-act="woop-next"]').dataset.step==='1');
  await ui.fill('#woopAnswer','Starting is difficult');await ui.act('woop-next',()=>document.querySelector('[data-act="woop-next"]').dataset.step==='2');
  await ui.fill('#woopAnswer','If distracted then take first step');await ui.act('woop-next',()=>state.tasks[0].woopPlan?.outcome==='Complete the final task');
  await ui.act('woop-delete',()=>state.tasks[0].woopPlan==null);
 });
 await h.scenario('manual backup restore delete and reset',{decorate:base},async ui=>{
  await ui.act('settings',()=>!!document.getElementById('stHorizon'));
  await ui.act('make-manual-backup',()=>document.querySelector('#modalRoot').textContent.includes('manual'));
  await ui.act('restore-local-backup',()=>!document.getElementById('stHorizon')&&state.tasks.some(t=>t.id==='synthetic-kept'));
  await ui.act('settings',()=>!!document.getElementById('stHorizon'));
  await ui.act('delete-local-backup',()=>!document.querySelector('[data-act="delete-local-backup"][aria-label*="manual backup"]'),'[data-act="delete-local-backup"][aria-label*="manual backup"]');
  await ui.act('wipe',()=>!!document.querySelector('[data-act="confirm-wipe"]'));
  await ui.act('confirm-wipe',()=>state.tasks.length===0&&!document.querySelector('[data-act="confirm-wipe"]'));
 });
 await h.scenario('debug log refresh selection and return',{decorate:base},async ui=>{
  await ui.act('settings',()=>!!document.getElementById('stHorizon'));await ui.act('view-support-diagnostics',()=>document.querySelector('#modalRoot h2').textContent==='Debug log');
  await ui.act('select-support-diagnostics',()=>!!document.getElementById('supportDiagnosticsData')&&document.activeElement.id==='supportDiagnosticsData');
  await ui.act('refresh-support-diagnostics',()=>document.querySelector('#modalRoot h2').textContent==='Debug log');
  await ui.act('return-support-diagnostics',()=>!!document.getElementById('stHorizon'));
 });
 await h.scenario('Help original apology and native backdrop dismissal',{decorate:base},async ui=>{
  await ui.act('help',()=>!!document.querySelector('#modalRoot .help'));
  await ui.act('reopen-apology',()=>document.querySelector('#modalRoot h2')?.textContent==='Sync and stability apology');
  await ui.backdrop();
 });
 for(const outcome of ['accepted','dismissed'])await h.scenario('native install '+outcome,{decorate:base},async ui=>{
  await ui.page.evaluate(outcome=>{window.__buttonInstallPrompts=0;const event=new Event('beforeinstallprompt',{cancelable:true});Object.defineProperties(event,{prompt:{value:async()=>{window.__buttonInstallPrompts++;}},userChoice:{value:Promise.resolve({outcome})}});dispatchEvent(event);},outcome);
  await ui.act('settings',()=>!!document.getElementById('stHorizon'));
  await ui.act('install-app',()=>!!document.querySelector('[data-act="native-install"]'));
  await ui.act('native-install',outcome==='accepted'?()=>window.__buttonInstallPrompts===1&&!document.querySelector('#modalRoot .modal'):()=>window.__buttonInstallPrompts===1&&document.querySelector('#modalRoot h2')?.textContent==='Install this app on your phone');
 });
 for(const mode of ['descending','chance','squared'])await h.scenario('both-mode scan and resume '+mode,{decorate:board=>{scanBase(board);board.settings.scanMode='both';}},async ui=>{
  const expected=new Function('return state.scanMode==='+JSON.stringify(mode)+'&&state.chain.length===1');
  await ui.act('start-scan',expected,'[data-act="start-scan"][data-mode="'+mode+'"]');
  await ui.act('start-working',()=>state.mode==='work');
  await ui.act('resume-scan',new Function('return state.mode==="scan"&&state.scanMode==='+JSON.stringify(mode)),'[data-act="resume-scan"][data-mode="'+mode+'"]');
 });
 const {runSceneScenarios}=await import('./button-safety-scenes.mjs');await runSceneScenarios(h);
 const {runCloudScenarios}=await import('./button-safety-cloud.mjs');await runCloudScenarios(h);
 const {runTransferScenarios}=await import('./button-safety-transfer.mjs');await runTransferScenarios(h);
}
