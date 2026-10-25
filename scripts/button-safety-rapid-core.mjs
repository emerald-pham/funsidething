import assert from 'node:assert/strict';

const ten=(ui,action,expected,selector,semantics)=>ui.burst(action,expected,{selector,semantics,expectedAccepted:10});
const once=(ui,action,expected,selector,semantics)=>ui.burst(action,expected,{selector,semantics,expectedAccepted:1});
const bounded=(ui,action,expected,selector,semantics,min=1,max=10)=>ui.burst(action,expected,{selector,semantics,expectedAccepted:{min,max}});

const activeBoard=board=>{
  board.contexts=[{id:'rapid-context',name:'Rapid context',active:true},{id:'rapid-delete-context',name:'Context to delete',active:true}];
  board.tasks[0].ctx=['rapid-context'];
  board.settings.showPostpone=true;
  board.settings.theme='light';
  board.addOpen=true;board.listOpen=false;board.ctxOpen=true;board.histOpen=false;
};

async function assert400(ui,label){
  const counts=await ui.page.evaluate(async()=>{
    const head=await window.ScannerDeviceStore.readHead(),stored=head?.payload?JSON.parse(head.payload):null;
    return {current:state.tasks.length,stored:stored?.tasks?.length,future:state.futurePopulated?.opaque?.length,
      storedFuture:stored?.futurePopulated?.opaque?.length};
  });
  assert.equal(counts.current,400,label+' starts with 400 active tasks');
  assert.equal(counts.stored,400,label+' starts with 400 durable tasks');
  assert.equal(counts.future,1048576,label+' retains the oversized unknown board field');
  assert.equal(counts.storedFuture,1048576,label+' retains the durable oversized unknown board field');
}

async function waitForStoredTaskCount(ui,count,label){
  const expected=new Function('return async()=>{const head=await window.ScannerDeviceStore.readHead();const stored=head?.payload?JSON.parse(head.payload):null;return state.tasks.length==='+JSON.stringify(count)+'&&stored?.tasks?.length==='+JSON.stringify(count)+'}')();
  await ui.waitFor(expected,12000,label);
}

async function ensureListOpen(ui,open=true){
  const current=await ui.page.evaluate(()=>state.listOpen===true);
  if(!current&&open)await ui.act('toggle-list',()=>state.listOpen===true);
  if(current&&!open)await ui.act('toggle-list',()=>state.listOpen===false);
}

async function ensureAddOpen(ui,open=true){
  const current=await ui.page.evaluate(()=>state.addOpen===true);
  if(!current&&open)await ui.act('toggle-add',()=>state.addOpen===true);
  if(current&&!open)await ui.act('toggle-add',()=>state.addOpen===false);
}

async function openEditor(ui,id){
  await ensureListOpen(ui,true);
  await ui.act('edit',()=>!!document.getElementById('etTitle'),'#listBody [data-act="edit"][data-id="'+id+'"]');
}

async function seedInstallPrompt(ui,outcome){
  await ui.page.evaluate(outcome=>{
    window.__rapidInstallPrompts=0;
    const event=new Event('beforeinstallprompt',{cancelable:true});
    Object.defineProperties(event,{prompt:{value:async()=>{window.__rapidInstallPrompts++;}},userChoice:{value:Promise.resolve({outcome})}});
    dispatchEvent(event);
  },outcome);
}

function historyRows(board){
  const task=board.tasks.find(row=>row.id==='synthetic-populated-6');
  task.ratingHistory=Array.from({length:25},(_,index)=>({v:1,id:'rapid-history-'+index,at:Date.now()-1000+index,
    seq:index+1,kind:index<2?'dislodge':'edit',after:{mu:25,sigma:8.333333333,likelihood:1,eligible:true,fallback:false,n:1,samples:250,topK:1}}));
}

function scannerBoard(board){
  activeBoard(board);board.contexts=[];board.tasks.forEach(task=>{task.ctx=[];task.due=null;task.startsAt=null;task.evergreen=false;});
  board.chain=[];board.considered={};board.cantAt={};board.workedAt={};board.mode='scan';board.candidateId=null;
  board.interventionActive=false;board.snooze=0;board.passStartedAt=0;board.passId='rapid-scan-pass';
  board.settings.thresholdPct=0;board.settings.skipOldestFirstDot=false;board.settings.scanMode='descending';board.settings.showPostpone=true;
}

function benchmarkBoard(board){
  scannerBoard(board);board.mode='work';board.chain=board.tasks.slice(0,20).map(task=>task.id);
  board.passStartedAt=Date.now()-60000;board.passId='rapid-benchmark-pass';
}

async function burstBenchmark(h,action,expected,semantics,expectedAccepted=10){
  await h.scenario('rapid benchmark '+action+' with 400 tasks',{decorate:benchmarkBoard},async ui=>{
    await assert400(ui,'Benchmark '+action);
    await ui.burst(action,expected,{selector:'[data-act="'+action+'"]',semantics,expectedAccepted});
  });
}

export async function runRapidCoreScenarios(h){
  await h.scenario('rapid Add and context actions with 400 saved tasks',{decorate:activeBoard},async ui=>{
    await assert400(ui,'Add/context');
    await ten(ui,'toggle-add',()=>state.addOpen===true&&document.getElementById('addToggle').getAttribute('aria-expanded')==='true',
      '#addToggle','Ten real toggles return the Add panel to its initially open state.');
    await ui.fill('#addStart','2026-10-01');
    await once(ui,'clear-task-date',()=>document.getElementById('addStart').value===''&&
      document.querySelector('#addStartClear').disabled,'#addStartClear',
      'The first clear removes its date and disables that now-empty control; remaining attempts are unavailable.');
    await ui.fill('#addDue','2026-10-02');
    await once(ui,'clear-task-date',()=>document.getElementById('addDue').value===''&&
      document.querySelector('#addDueClear').disabled,'#addDueClear',
      'The first clear removes its date and disables that now-empty control; remaining attempts are unavailable.');
    await ten(ui,'qctx',()=>document.querySelector('#quickCtxRow [data-act="qctx"][data-id="rapid-context"]')?.getAttribute('aria-pressed')==='false',
      '#quickCtxRow [data-act="qctx"][data-id="rapid-context"]',
      'Ten quick-add context presses return the draft chip to its initially unselected state.');

    await ui.select('#addPrerequisite','synthetic-populated-1');
    await once(ui,'add-dependency',()=>document.querySelectorAll('#addDependencies select').length===2&&
      !document.querySelector('#addDependencies [data-act="add-dependency"]'),
      '#addDependencies [data-act="add-dependency"]',
      'One dependency row is appended; the blank row prevents another until it is filled.');
    await ui.select('#addPrerequisite1','synthetic-populated-2');
    await once(ui,'remove-dependency',()=>document.querySelectorAll('#addDependencies select').length===1,
      '#addDependencies [data-act="remove-dependency"][data-index="1"]',
      'The selected added dependency row is removed; that row-specific button disappears.');
    await once(ui,'remove-dependency',()=>document.querySelectorAll('#addDependencies select').length===1&&
      document.querySelector('#addPrerequisite').value==='',
      '#addDependencies [data-act="remove-dependency"][data-index="0"]',
      'The final selected dependency is removed, leaving one empty row and no remove action.');

    await ui.fill('#addInput','Rapid Add accepted once');
    await ten(ui,'add',()=>state.tasks.length===401&&state.tasks.filter(task=>task.title==='Rapid Add accepted once').length===1&&
      document.getElementById('addInput').value==='',
      '#addButton','All ten native Add attempts are delivered; the typed draft is consumed exactly once and blank repeats add nothing.');
    await waitForStoredTaskCount(ui,401,'The one accepted Add is durably saved');
    await ui.burst('add-ctx',()=>state.contexts.filter(context=>context.name==='Safety gate context').length===10,
      {selector:'#ctxPanel [data-act="add-ctx"]',semantics:'Each accepted prompt creates one context; ten accepted context prompts add ten rows.',expectedAccepted:10});
    const contextPanelState=await ui.page.evaluate(()=>({open:state.ctxOpen===true,rendered:!!document.querySelector('#ctxPanel .ctxgrid')}));
    assert.equal(contextPanelState.rendered,contextPanelState.open,'Context panel starts with its saved open/closed state rendered');
    const contextPanelInitiallyOpen=contextPanelState.open;
    const contextPanelReturns=new Function('return ()=>state.ctxOpen==='+JSON.stringify(contextPanelInitiallyOpen)+
      '&& (!!document.querySelector("#ctxPanel .ctxgrid"))==='+JSON.stringify(contextPanelInitiallyOpen))();
    await ten(ui,'toggle-ctx',contextPanelReturns,
      '#ctxPanel [data-act="toggle-ctx"]','Ten context-panel toggles return the panel to its exact initial open/closed state.');
    await ten(ui,'cycle-context',()=>document.querySelector('#ctxPanel [data-act="cycle-context"][data-id="rapid-context"]')?.dataset.filterState==='included',
      '#ctxPanel [data-act="cycle-context"][data-id="rapid-context"]',
      'Ten included/excluded cycles return the context to its initially included state.');
    await ten(ui,'toggle-no-context',()=>state.settings.excludeNoContext===false&&
      document.querySelector('#ctxPanel [data-act="toggle-no-context"]')?.dataset.filterState!=='excluded',
      '#ctxPanel [data-act="toggle-no-context"]','Ten No context toggles return the saved exclusion choice to its initial value.');
  });

  await h.scenario('rapid Settings, theme, context management, and save with 400 tasks',{decorate:activeBoard},async ui=>{
    await assert400(ui,'Settings/context management');
    await once(ui,'settings',()=>document.querySelector('#modalRoot h2')?.textContent==='Settings','[data-act="settings"]',
      'The first Settings press opens its modal; later attempts are obscured by that modal.');
    const summaries=await ui.page.locator('#modalRoot details.settings-section > summary').count();
    assert.ok(summaries>0,'Settings renders its disclosure summaries');
    await ten(ui,'disclosure',()=>document.querySelector('#modalRoot details.settings-section > summary')?.parentElement.open===true,
      '#modalRoot details.settings-section > summary','Ten native summary presses return the initially open first Settings disclosure to open.');
    await ui.fill('#newCtxName','Rapid named context');
    await once(ui,'add-ctx-named',()=>state.contexts.filter(context=>context.name==='Rapid named context').length===1&&
      document.getElementById('newCtxName').value==='',
      '#modalRoot [data-act="add-ctx-named"]',
      'The first nonempty named-context press adds one context and rerenders Settings; later attempts are unavailable while its section is collapsed.');
    await once(ui,'del-ctx',()=>!state.contexts.some(context=>context.id==='rapid-delete-context'),
      '#modalRoot [data-act="del-ctx"][data-id="rapid-delete-context"]',
      'The first delete removes its context row; the same row-specific action disappears.');
    await ui.fill('#stHorizon','61');
    await once(ui,'save-settings',()=>state.settings.horizonMin===61&&!document.querySelector('#modalRoot .modal'),
      '#modalRoot [data-act="save-settings"]','The first Save settings press saves the draft and closes Settings; later attempts are unavailable.');
    await ten(ui,'cycle-theme',()=>state.settings.theme==='dark'&&document.documentElement.dataset.theme==='dark',
      '#themeBtn','Ten theme cycles from Light end on Dark (the defined three-state cycle plus one).');
  });

  await h.scenario('rapid All Tasks and bulk editing with 400 saved tasks',{decorate:board=>{
    activeBoard(board);board.tasks.forEach(task=>{task.url='https://example.com/'+task.id;});
  }},async ui=>{
    await assert400(ui,'All Tasks/bulk');
    await ensureListOpen(ui,true);
    await ten(ui,'toggle-list',()=>state.listOpen===true&&!document.getElementById('listBody').hidden,
      '#listWrap [data-act="toggle-list"]','Ten All Tasks toggles return the list to its initially open state.');
    await ten(ui,'list-tag',()=>document.querySelector('#listTagRow [data-act="list-tag"][data-id="c:rapid-context"]')?.getAttribute('aria-pressed')==='false',
      '#listTagRow [data-act="list-tag"][data-id="c:rapid-context"]','Ten repeated context filters return the tag filter to its initial unselected state.');
    await ten(ui,'list-eligibility',()=>document.querySelector('#listEligibilityRow [data-act="list-eligibility"][data-id="eligible"]')?.getAttribute('aria-pressed')==='true',
      '#listEligibilityRow [data-act="list-eligibility"][data-id="eligible"]',
      'Ten repeated Eligible selections remain on the same explicitly selected filter.');
    await ui.fill('#listSearch','rapid no match');
    await once(ui,'clear-list-filters',()=>document.getElementById('listSearch').value===''&&
      !document.querySelector('#listTagRow [aria-pressed="true"]')&&
      document.querySelector('#listEligibilityRow [data-id="all"]')?.getAttribute('aria-pressed')==='true'&&
      document.querySelectorAll('#listBody [data-act="edit"]').length===400,
      '#listBody [data-act="clear-list-filters"]',
      'The first Clear filters press restores all 400 rows; the empty-result action disappears.');

    await ten(ui,'bulk-select',()=>document.querySelector('#listBulkToolbar [data-act="bulk-select"]')?.getAttribute('aria-pressed')==='true',
      '#listBulkToolbar [data-act="bulk-select"]','Ten start-selection presses leave selection mode on; the action is idempotent.');
    await ten(ui,'bulk-toggle',()=>document.querySelector('#listBody [data-act="bulk-toggle"][data-id="synthetic-kept"]')?.getAttribute('aria-pressed')==='false',
      '#listBody [data-act="bulk-toggle"][data-id="synthetic-kept"]',
      'Ten presses on one task selection toggle it an even number of times back to unselected.');
    await ten(ui,'bulk-select-all',()=>document.querySelector('#listBulkToolbar [data-act="bulk-edit"]')?.disabled===false,
      '#listBulkToolbar [data-act="bulk-select-all"]','Ten Select all presses remain accepted and leave all 400 visible tasks selected.');
    await once(ui,'bulk-cancel',()=>document.querySelector('#listBulkToolbar [data-act="bulk-select"]')?.getAttribute('aria-pressed')==='false'&&
      !document.querySelector('#listBulkToolbar [data-act="bulk-cancel"]'),
      '#listBulkToolbar [data-act="bulk-cancel"]','The first Cancel selection press clears selection mode; its action disappears.');

    await ui.act('bulk-select',()=>document.querySelector('#listBulkToolbar [data-act="bulk-select"]')?.getAttribute('aria-pressed')==='true');
    await ui.act('bulk-select-all',()=>document.querySelector('#listBulkToolbar [data-act="bulk-edit"]')?.disabled===false);
    await once(ui,'bulk-edit',()=>document.querySelector('#modalRoot h2')?.textContent==='Edit 400 selected tasks'&&
      !!document.getElementById('bulkApplyUrl'),
      '#listBulkToolbar [data-act="bulk-edit"]','The first Edit press opens a 400-task modal; further attempts are obscured.');
    await ten(ui,'bulk-clear',()=>document.getElementById('bulkApplyUrl')?.checked===true&&
      document.getElementById('bulkStatusUrl')?.textContent.includes('Will clear'),
      '#modalRoot [data-act="bulk-clear"][data-field="url"]',
      'Ten repeated Clear-link intents remain accepted and idempotently mark the same field for all 400 selected tasks.');
    await once(ui,'bulk-save',()=>!document.getElementById('bulkApplyUrl')&&
      state.tasks.length===400&&state.tasks.every(task=>task.url===null),
      '#modalRoot [data-act="bulk-save"]','The first Save selected press clears the chosen field for 400 tasks and closes the modal.');
    await waitForStoredTaskCount(ui,400,'Bulk save preserves all 400 tasks');
  });

  await h.scenario('rapid editor, history, and task actions with 400 saved tasks',{decorate:board=>{
    activeBoard(board);board.tasks[0].due='2026-10-02';board.considered={'synthetic-populated-5':'no'};historyRows(board);
  }},async ui=>{
    await assert400(ui,'Editor/history');
    await ensureListOpen(ui,true);
    await once(ui,'edit',()=>document.querySelector('#modalRoot h2')?.textContent==='Edit task'&&!!document.getElementById('etTitle'),
      '#listBody [data-act="edit"][data-id="synthetic-kept"]','The first Edit press opens the modal; remaining attempts are covered by it.');
    await ui.fill('#etTitle','Rapid editor saved');
    await ui.fill('#etDue','2026-10-02');
    await once(ui,'clear-task-date',()=>document.getElementById('etDue').value===''&&document.getElementById('etDueClear').disabled,
      '#modalRoot #etDueClear','The first editor date clear empties the field and disables that control.');
    await ui.select('#etPrerequisite','synthetic-populated-1');
    await once(ui,'add-dependency',()=>document.querySelectorAll('#editDependencies select').length===2&&
      !document.querySelector('#editDependencies [data-act="add-dependency"]'),
      '#editDependencies [data-act="add-dependency"]','One editor dependency row is appended; the blank row hides the add action.');
    await ui.select('#etPrerequisite1','synthetic-populated-2');
    await once(ui,'remove-dependency',()=>document.querySelectorAll('#editDependencies select').length===1,
      '#editDependencies [data-act="remove-dependency"][data-index="1"]','The added editor dependency row is removed and its action disappears.');
    await ui.fill('#etTitle','Rapid editor saved');
    await once(ui,'save-edit',()=>state.tasks.find(task=>task.id==='synthetic-kept')?.title==='Rapid editor saved'&&
      !document.getElementById('etTitle'),
      '#modalRoot [data-act="save-edit"]','The first Save edit press saves the draft and closes the modal.');

    await openEditor(ui,'synthetic-kept');
    await once(ui,'done-task',()=>state.tasks.find(task=>task.id==='synthetic-kept')?.done===true&&
      !document.getElementById('etTitle'),
      '#modalRoot [data-act="done-task"]','The first Done press completes the edited task and closes the modal.');
    await ten(ui,'toggle-hist',()=>state.histOpen===false,'#histPanel [data-act="toggle-hist"]',
      'Ten History-panel toggles return the initially closed panel to closed.');
    await ui.act('toggle-hist',()=>state.histOpen===true);
    await once(ui,'restore',()=>state.tasks.find(task=>task.id==='synthetic-kept')?.done===false&&
      !document.querySelector('#histPanel [data-act="restore"][data-id="synthetic-kept"]'),
      '#histPanel [data-act="restore"][data-id="synthetic-kept"]','The first Restore press returns the task to the active board; its History row disappears.');

    await openEditor(ui,'synthetic-populated-1');
    await once(ui,'worked-task',()=>!!state.workedAt['synthetic-populated-1']&&!document.getElementById('etTitle'),
      '#modalRoot [data-act="worked-task"]','The first Worked press records the task and closes the editor.');
    await openEditor(ui,'synthetic-populated-2');
    await once(ui,'dot-task',()=>state.chain.includes('synthetic-populated-2')&&!document.getElementById('etTitle'),
      '#modalRoot [data-act="dot-task"]','The first Dot press adds the task to the chain and closes the editor.');
    await openEditor(ui,'synthetic-populated-5');
    await once(ui,'return-candidate',()=>state.considered['synthetic-populated-5']!=='no'&&
      !document.querySelector('#modalRoot [data-act="return-candidate"]'),
      '#modalRoot [data-act="return-candidate"]','The first Return press clears the saved skip; the now-unneeded editor action disappears.');
    await openEditor(ui,'synthetic-populated-6');
    await once(ui,'more-rating-history',()=>document.querySelectorAll('#taskRatingHistory .rating-event').length===25&&
      !document.querySelector('#taskRatingHistory [data-act="more-rating-history"]'),
      '#modalRoot [data-act="more-rating-history"]','The first More history press reveals all 25 saved observations and removes the paging action.');
    await once(ui,'close-modal',()=>!document.getElementById('etTitle'),'#modalRoot [data-act="close-modal"]',
      'The first Close press dismisses the editor; further attempts have no modal target.');

    await openEditor(ui,'synthetic-populated-4');
    await once(ui,'delete-task',()=>!state.tasks.some(task=>task.id==='synthetic-populated-4')&&
      !document.getElementById('etTitle'),
      '#modalRoot [data-act="delete-task"]','The first Delete press removes the selected task and closes the editor.');
    await waitForStoredTaskCount(ui,399,'Editor deletion is durably saved');
  });

  await h.scenario('rapid Undo consumes one actual saved edit frame',{decorate:activeBoard},async ui=>{
    await assert400(ui,'Undo');
    const originalTitle=await ui.page.evaluate(()=>state.tasks.find(task=>task.id==='synthetic-kept')?.title);
    assert.equal(await ui.page.locator('[data-act="undo"]').isDisabled(),true,'Undo begins with no action to consume');
    for(let index=1;index<=10;index++){
      const title='Rapid undo frame '+index;
      await openEditor(ui,'synthetic-kept');await ui.fill('#etTitle',title);
      await ui.act('save-edit',()=>state.tasks.find(task=>task.id==='synthetic-kept')?.title===title&&!document.getElementById('etTitle'));
    }
    await ui.waitFor(async()=>{
      const head=await window.ScannerDeviceStore.readHead(),stored=head?.payload?JSON.parse(head.payload):null;
      return stored?.tasks?.find(task=>task.id==='synthetic-kept')?.title==='Rapid undo frame 10';
    },12000,'All ten real edit frames are durably saved before Undo');
    await ten(ui,'undo',()=>state.tasks.find(task=>task.id==='synthetic-kept')?.title===originalTitle&&
      document.querySelector('[data-act="undo"]')?.disabled===true,
      '[data-act="undo"]','Ten Undo presses consume the ten actual saved edit frames in order and leave no further undo action.');
    await waitForStoredTaskCount(ui,400,'Undo preserves all 400 durable tasks');
    const restored=await ui.page.evaluate(async()=>{const head=await window.ScannerDeviceStore.readHead(),stored=head?.payload?JSON.parse(head.payload):null;return stored?.tasks?.find(task=>task.id==='synthetic-kept')?.title;});
    assert.equal(restored,originalTitle,'Ten accepted Undo actions restore the exact durable baseline title');
  });

  await h.scenario('rapid scanner candidate actions with 400 active tasks',{decorate:scannerBoard},async ui=>{
    await assert400(ui,'Scanner candidates');
    await once(ui,'start-scan',()=>state.chain.length===1&&!!state.candidateId,'[data-act="start-scan"]',
      'The first Start press creates the initial dot and candidate; scanning controls replace Start.');
    await ten(ui,'yes',()=>state.chain.length===11&&!!state.candidateId,'#scan [data-act="yes"]',
      'Ten Yes presses choose ten new offered candidates while 400 tasks keep scanning active.');
    await ten(ui,'no',()=>Object.values(state.considered).filter(value=>value==='no').length===10&&!!state.candidateId,
      '#scan [data-act="no"]','Ten No presses skip ten distinct offered candidates; the next candidate remains available.');
    await ten(ui,'cant',()=>Object.values(state.considered).filter(value=>value==='cant').length===10&&!!state.candidateId,
      '#scan [data-act="cant"]','Ten Can’t presses record ten distinct temporary holds while preserving the next candidate.');
    await ten(ui,'postpone',()=>state.tasks.filter(task=>task.postponeOps?.some(op=>op.until>Date.now())).length===10&&!!state.candidateId,
      '#scan [data-act="postpone"]','Ten Postpone presses defer ten distinct candidates; the remaining active tasks keep the control available.');
    await ten(ui,'cand-done',()=>state.tasks.filter(task=>task.done).length===10&&!!state.candidateId,
      '#scan [data-act="cand-done"]','Ten candidate Done presses complete ten distinct tasks and keep the next candidate available.');
    await ten(ui,'cand-worked',()=>Object.keys(state.workedAt).length===10&&!!state.candidateId,
      '#scan [data-act="cand-worked"]','Ten candidate Worked presses record ten distinct tasks and keep scanning available.');
    await ten(ui,'reveal',()=>state.listOpen===true&&document.getElementById('listBody').getClientRects().length>0,
      '#scan [data-act="reveal"]','Ten repeated reveal presses keep All Tasks open while the same chain crumb remains visible.');
    await waitForStoredTaskCount(ui,400,'Scanner decisions preserve the 400-task board');
  });

  await burstBenchmark(h,'bench-done',()=>state.tasks.filter(task=>task.done).length===10&&state.chain.length===10,
    'Ten benchmark Done presses complete ten queued tasks; the next benchmark is exposed after each.');
  await burstBenchmark(h,'bench-cant',()=>Object.values(state.considered).filter(value=>value==='cant').length===10&&state.chain.length===10,
    'Ten benchmark Can’t presses remove ten current benchmarks and expose the next each time.');
  await burstBenchmark(h,'bench-postpone',()=>state.mode==='scan'&&state.tasks.filter(task=>task.postponeOps?.some(op=>op.until>Date.now())).length===1,
    'The first benchmark postponement starts scanning; candidate choice makes further benchmark presses unavailable.',1);
  await burstBenchmark(h,'dislodge',()=>Object.values(state.considered).filter(value=>value==='dislodged').length===10&&state.chain.length===10,
    'Ten Dislodge presses remove ten successive benchmarks while retaining the rest of the chain.');
  await burstBenchmark(h,'worked',()=>Object.keys(state.workedAt).length===10&&state.chain.length===10,
    'Ten benchmark Worked presses record ten queued tasks and expose the next benchmark each time.');

  await h.scenario('rapid scan and work transitions with 400 tasks',{decorate:board=>{
    scannerBoard(board);board.mode='work';board.chain=['synthetic-kept'];board.passStartedAt=Date.now()-60000;
  }},async ui=>{
    await assert400(ui,'Scan/work transitions');
    await once(ui,'resume-scan',()=>state.mode==='scan'&&!!state.candidateId,'[data-act="resume-scan"]',
      'The first Resume press starts scanning; its Work-mode control disappears.');
    await once(ui,'start-working',()=>state.mode==='work'&&!document.querySelector('#scan [data-act="start-working"]'),
      '#scan [data-act="start-working"]','The first Done adding press pauses scanning; the scan-mode control disappears.');
  });

  await h.scenario('rapid Continue scan from intervention with 400 tasks',{decorate:board=>{
    scannerBoard(board);board.chain=['synthetic-kept'];board.candidateId='synthetic-populated-1';
    board.interventionActive=true;board.interventionP=0.01;
  }},async ui=>{
    await assert400(ui,'Intervention');
    await once(ui,'continue-scan',()=>state.interventionActive===false&&state.mode==='scan',
      '#scan [data-act="continue-scan"]','Continue clears the intervention once; later attempts are unavailable after the prompt is dismissed.');
  });

  await h.scenario('rapid Rescan on an exhausted 400-task fixture',{fixtureRole:'exhausted',decorate:board=>{
    scannerBoard(board);board.settings.skipOldestFirstDot=true;board.passStartedAt=Date.now();
    for(const task of board.tasks)board.considered[task.id]='no';
  }},async ui=>{
    await once(ui,'rescan',()=>!Object.values(state.considered).includes('no')&&!!state.candidateId,
      '#scan [data-act="rescan"]','Rescan clears the skipped set once; its control disappears when a candidate becomes available.');
  });

  await h.scenario('rapid New pass on an exhausted 400-task fixture',{fixtureRole:'exhausted',decorate:board=>{
    scannerBoard(board);board.settings.skipOldestFirstDot=true;board.passStartedAt=Date.now();
    for(const task of board.tasks)board.considered[task.id]='no';
  }},async ui=>{
    await once(ui,'new-pass',()=>Object.keys(state.considered).length===0&&state.passStartedAt>0,
      '#scan [data-act="new-pass"]','Start a fresh pass clears the completed skipped pass once; active scanning replaces the button.');
  });

  await h.scenario('rapid overdue WOOP action with 400 tasks',{decorate:board=>{
    scannerBoard(board);for(const task of board.tasks)task.due='2000-01-01';
  }},async ui=>{
    await assert400(ui,'Overdue WOOP');
    await ui.act('start-scan',()=>!!state.candidateId);
    await once(ui,'run-woop',()=>document.querySelector('#modalRoot h2')?.textContent==='WOOP for overdue task'&&
      state.mode==='work'&&!!state.tasks.find(task=>task.id===state.candidateId||state.chain.includes(task.id)),
      '#scan [data-act="run-woop"]','The first Run WOOP press chooses the overdue task and opens its walkthrough; modal coverage blocks repeats.');
    await once(ui,'close-modal',()=>!document.querySelector('#modalRoot .modal'),'#modalRoot [data-act="close-modal"]',
      'The first Close press dismisses the overdue walkthrough; later attempts have no dialog target.');
  });

  await h.scenario('rapid final-task WOOP walkthrough and delete with 400 saved tasks',{
    fixtureRole:'sole',decorate:board=>{
      scannerBoard(board);board.tasks.forEach((task,index)=>{task.done=index!==0;task.completedAt=index?Date.now()-1000+index:null;task.lastDoneAt=index?Date.now()-1000+index:null;});
      board.settings.lastTaskWoop=true;board.mode='work';board.chain=['synthetic-kept'];
      board.tasks[0].ratingHistory=[0,1].map(index=>({v:1,id:'rapid-final-dislodge-'+index,at:Date.now()-2000+index,
        seq:index+1,kind:'dislodge',after:{mu:25,sigma:8.333333333,likelihood:1,eligible:true,fallback:false,n:1,samples:250,topK:1}}));
    }
  },async ui=>{
    await once(ui,'woop-start',()=>document.querySelector('#modalRoot h2')?.textContent==='WOOP for final task'&&
      !!document.getElementById('woopAnswer'),'#scan [data-act="woop-start"]',
      'The first final-task WOOP press opens its answer dialog; later attempts are covered.');
    await ui.fill('#woopAnswer','Rapid final outcome');
    await ten(ui,'woop-next',()=>document.querySelector('#modalRoot [data-act="woop-next"]')?.dataset.step==='1',
      '#modalRoot [data-act="woop-next"]','The first valid Next advances; remaining accepted presses have no answer and do not skip a WOOP step.');
    await ui.fill('#woopAnswer','Rapid final obstacle');
    await ten(ui,'woop-next',()=>document.querySelector('#modalRoot [data-act="woop-next"]')?.dataset.step==='2',
      '#modalRoot [data-act="woop-next"]','The first valid Next advances; remaining accepted presses cannot skip the required final answer.');
    await ui.fill('#woopAnswer','Rapid final if then plan');
    await once(ui,'woop-next',()=>!document.getElementById('woopAnswer')&&
      state.tasks.find(task=>task.id==='synthetic-kept')?.woopPlan?.outcome==='Rapid final outcome',
      '#modalRoot [data-act="woop-next"]','The first Save WOOP press stores the complete plan and closes the modal.');
    await once(ui,'woop-delete',()=>state.tasks.find(task=>task.id==='synthetic-kept')?.woopPlan===null&&
      !document.querySelector('#scan [data-act="woop-delete"]'),
      '#scan [data-act="woop-delete"]','The first Delete WOOP press removes the saved plan and replaces its action.');
  });

  await h.scenario('rapid backup creation, restore, and deletion with 400 saved tasks',{decorate:activeBoard},async ui=>{
    await assert400(ui,'Backup controls');
    await once(ui,'settings',()=>document.querySelector('#modalRoot h2')?.textContent==='Settings','[data-act="settings"]',
      'The first Settings press opens its modal; remaining attempts are obscured.');
    await ui.fill('#stHorizon','61');
    await ui.act('save-settings',()=>state.settings.horizonMin===61&&!document.getElementById('stHorizon'));
    await ui.act('settings',()=>document.querySelector('#modalRoot h2')?.textContent==='Settings');
    await once(ui,'make-manual-backup',async()=>{
      const rows=await window.ScannerDeviceStore.listBackups();
      return rows.filter(row=>row.kind==='manual').length===1&&document.querySelector('#modalRoot h2')?.textContent==='Settings';
    },'#modalRoot [data-act="make-manual-backup"]',
    'The first press retains an exact 400-task manual copy and rerenders Settings with Data and backups collapsed; later attempts are unavailable.');
    await ui.fill('#stHorizon','77');
    await ui.act('save-settings',()=>state.settings.horizonMin===77&&!document.getElementById('stHorizon'));
    await ui.act('settings',()=>document.querySelector('#modalRoot h2')?.textContent==='Settings');
    await ui.expose('[data-act="restore-local-backup"][data-id]');
    const restoreId=await ui.page.evaluate(()=>[...document.querySelectorAll('.backup-row')]
      .find(row=>row.textContent.toLowerCase().includes('manual'))
      ?.querySelector('[data-act="restore-local-backup"][data-id]')?.dataset.id||null);
    assert.ok(restoreId,'At least one readable retained backup offers Restore');
    await bounded(ui,'restore-local-backup',async()=>{
      const head=await window.ScannerDeviceStore.readHead(),stored=head?.payload?JSON.parse(head.payload):null;
      return state.settings.horizonMin===61&&stored?.settings?.horizonMin===61&&state.tasks.length===400&&stored?.tasks?.length===400;
    },'[data-act="restore-local-backup"][data-id="'+restoreId+'"]',
    'The first confirmed restore reapplies the exact 400-task value; any repeated clicks are safe same-source repeats or become unavailable when Settings closes.');
    await ui.waitFor(async()=>{
      const head=await window.ScannerDeviceStore.readHead(),stored=head?.payload?JSON.parse(head.payload):null;
      return state.settings.horizonMin===61&&stored?.settings?.horizonMin===61&&state.tasks.length===400&&stored?.tasks?.length===400;
    },12000,'The repeated restore leaves the same 400-task source durable');
    await ui.act('settings',()=>document.querySelector('#modalRoot h2')?.textContent==='Settings');
    await once(ui,'delete-local-backup',async()=>{
      const rows=await window.ScannerDeviceStore.listBackups();
      return !document.querySelector('[data-act="delete-local-backup"][aria-label*="manual backup"]')&&
        rows.filter(row=>row.kind==='manual').length===0;
    },'[data-act="delete-local-backup"][data-id="'+restoreId+'"]',
    'The first confirmed delete removes the selected manual backup; its row and remaining manual-backup controls disappear.');
  });

  await h.scenario('rapid history clearing preserves the remaining 400-task workspace',{decorate:board=>{
    activeBoard(board);board.workLog=[{id:'rapid-old-history',taskId:'synthetic-kept',title:'Old saved work',kind:'worked',at:Date.now()-60000}];
  }},async ui=>{
    await assert400(ui,'Clear history');
    await once(ui,'settings',()=>document.querySelector('#modalRoot h2')?.textContent==='Settings','[data-act="settings"]',
      'The first Settings press opens its modal; later attempts are obscured.');
    await once(ui,'clear-done',()=>state.workLog.length===0&&!document.querySelector('#modalRoot [data-act="clear-done"]'),
      '#modalRoot [data-act="clear-done"]','The first confirmed Clear history press removes the one history entry; the action disappears.');
    await waitForStoredTaskCount(ui,400,'Clearing history preserves all 400 tasks');
  });

  await h.scenario('rapid reset confirms once and retains the 400-task backup',{decorate:activeBoard},async ui=>{
    await assert400(ui,'Reset');
    await ui.act('settings',()=>document.querySelector('#modalRoot h2')?.textContent==='Settings');
    await once(ui,'wipe',()=>document.querySelector('#modalRoot h2')?.textContent==='Confirm reset'&&
      !!document.querySelector('#modalRoot [data-act="confirm-wipe"]'),
      '#modalRoot [data-act="wipe"]','The first Reset press opens confirmation; later attempts are covered by the dialog.');
    await once(ui,'confirm-wipe',async()=>{
      const head=await window.ScannerDeviceStore.readHead(),stored=head?.payload?JSON.parse(head.payload):null;
      const backups=await window.ScannerDeviceStore.listBackups();
      return state.tasks.length===0&&stored?.tasks?.length===0&&
        backups.some(row=>row.kind==='before-reset'&&JSON.parse(row.payload).tasks.length===400);
    },'#modalRoot [data-act="confirm-wipe"]',
    'The first confirmation safely resets the board after saving its exact 400-task copy; further attempts are unavailable.');
  });

  await h.scenario('rapid Debug log and Help actions with 400 saved tasks',{decorate:activeBoard},async ui=>{
    await assert400(ui,'Debug and Help');
    await ui.act('settings',()=>document.querySelector('#modalRoot h2')?.textContent==='Settings');
    await once(ui,'view-support-diagnostics',()=>document.querySelector('#modalRoot h2')?.textContent==='Debug log',
      '#modalRoot [data-act="view-support-diagnostics"]','The first Debug log press opens its modal; repeats are obscured.');
    await ten(ui,'select-support-diagnostics',()=>document.activeElement?.id==='supportDiagnosticsData'&&
      document.getElementById('supportDiagnosticsData').selectionStart===0&&
      document.getElementById('supportDiagnosticsData').selectionEnd===document.getElementById('supportDiagnosticsData').value.length,
      '#modalRoot [data-act="select-support-diagnostics"]','Ten Select presses keep the whole diagnostic text selected and never add board content.');
    await ten(ui,'refresh-support-diagnostics',()=>document.querySelector('#modalRoot h2')?.textContent==='Debug log',
      '#modalRoot [data-act="refresh-support-diagnostics"]','Ten refresh presses redraw the same Debug log surface without closing it.');
    await once(ui,'return-support-diagnostics',()=>document.querySelector('#modalRoot h2')?.textContent==='Settings',
      '#modalRoot [data-act="return-support-diagnostics"]','The first Return press restores Settings; its Debug-only action disappears.');
    await once(ui,'close-modal',()=>!document.querySelector('#modalRoot .modal'),'#modalRoot [data-act="close-modal"]',
      'The first Close press dismisses Settings; later attempts have no modal target.');
    await once(ui,'help',()=>document.querySelector('#modalRoot .help'),'[data-act="help"]',
      'The first Help press opens its modal; the toolbar control is obscured.');
    const helpSummary=await ui.page.locator('#modalRoot .help details summary').count();
    assert.ok(helpSummary>0,'Help renders FAQ disclosures');
    await ten(ui,'disclosure',()=>document.querySelector('#modalRoot .help details summary')?.parentElement.open===false,
      '#modalRoot .help details summary','Ten Help disclosure presses return the FAQ to its initially closed state.');
    await once(ui,'reopen-apology',()=>document.querySelector('#modalRoot h2')?.textContent==='Sync and stability apology',
      '#modalRoot [data-act="reopen-apology"]','The first apology press opens its original notice; subsequent attempts are covered.');
    await once(ui,'mback',()=>!document.querySelector('#modalRoot .modal'),'#modalRoot .mback',
      'One native backdrop press dismisses the apology; further backdrop attempts disappear.');
  });

  await h.scenario('rapid first-run Quick Start acknowledges once with 400 tasks',{decorate:board=>{
    activeBoard(board);board.seenQuickStart=false;
  }},async ui=>{
    await assert400(ui,'Quick Start');
    await once(ui,'ok-quickstart',()=>!document.querySelector('#modalRoot .modal')&&state.seenQuickStart===true,
      '#modalRoot [data-act="ok-quickstart"]','The first OK press records acknowledgement and closes Quick Start; remaining attempts are unavailable.');
  });

  for(const outcome of ['accepted','dismissed'])await h.scenario('rapid native install '+outcome+' with 400 tasks',{decorate:activeBoard},async ui=>{
    await assert400(ui,'Native install '+outcome);await seedInstallPrompt(ui,outcome);
    await once(ui,'install-app',()=>document.querySelector('#modalRoot h2')?.textContent==='Install this app on your phone'&&
      !!document.querySelector('#modalRoot [data-act="native-install"]'),
      '[data-act="install-app"]','The first install-help press opens the modal; later attempts are obscured.');
    const expectedInstallOutcome=outcome==='accepted'
      ?()=>window.__rapidInstallPrompts===1&&!document.querySelector('#modalRoot .modal')
      :()=>window.__rapidInstallPrompts===1&&document.querySelector('#modalRoot h2')?.textContent==='Install this app on your phone'&&
        !document.querySelector('#modalRoot [data-act="native-install"]');
    await once(ui,'native-install',expectedInstallOutcome,'#modalRoot [data-act="native-install"]',
    outcome==='accepted'?'The prompt is consumed once and closes Help; remaining attempts have no install control.':'The declined prompt is consumed once and restores manual instructions without an Install button.');
    if(outcome==='dismissed')await once(ui,'close-modal',()=>!document.querySelector('#modalRoot .modal'),
      '#modalRoot [data-act="close-modal"]','The first Done press closes the manual install instructions; repeats have no modal target.');
  });
}
