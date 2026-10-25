// Full-app scenarios for the scene, motion, location, and help controls.
// Expected results inspect only rendered DOM or the app's read-only public state.
function sceneFixture({seenQuickStart=true}={}){
  return {decorate(board){
    board.seenQuickStart=seenQuickStart;
    board.settings={...board.settings,theme:'light',scene:{time:null,season:null,location:null}};
  }};
}

function disclosureExpectation(index,open){
  // Playwright serializes the predicate into the page, so embed only the
  // numeric summary index and expected boolean instead of capturing Node state.
  return new Function(`return document.querySelectorAll('#modalRoot .help summary')[${index}]?.parentElement.open === ${open};`);
}

function scenePresetExpectation(preset){
  // Presets are a fixed list below; embedding the literal keeps this predicate
  // independent of Node closures when Playwright evaluates it in the page.
  const value=JSON.stringify(preset);
  return new Function(`return state.settings.scene.time===${value}
    && [...document.querySelectorAll('#sceneTimeDialog [data-scene-preset]')].some(button=>button.dataset.scenePreset===${value}
      && button.getAttribute('aria-pressed')==='true');`);
}

export async function runSceneScenarios(h){
  await h.scenario('theme preference changes through its button',sceneFixture(),async ui=>{
    await ui.act('cycle-theme',()=>state.settings.theme==='dark'&&document.documentElement.getAttribute('data-theme')==='dark','#themeBtn');
  });

  await h.scenario('motion settings open and both choices respond',sceneFixture(),async ui=>{
    await ui.act('scene-settings',()=>document.getElementById('motionDialog')?.open===true,'#motionButton');
    await ui.click('#motionDialog [data-landscape-motion="normal"]',()=>{
      const choice=JSON.parse(localStorage.getItem('fvp:chain-scanner:landscape-motion'));
      return !document.getElementById('motionDialog')?.open
        && document.querySelector('#motionDialog [data-landscape-motion="normal"]')?.getAttribute('aria-pressed')==='true'
        && choice?.choice==='normal';
    },'Choose normal motion');
    await ui.act('scene-settings',()=>document.getElementById('motionDialog')?.open===true,'#motionButton');
    await ui.click('#motionDialog [data-landscape-motion="reduced"]',()=>{
      const choice=JSON.parse(localStorage.getItem('fvp:chain-scanner:landscape-motion'));
      return !document.getElementById('motionDialog')?.open
        && document.querySelector('#motionDialog [data-landscape-motion="reduced"]')?.getAttribute('aria-pressed')==='true'
        && choice?.choice==='reduced'
        && document.documentElement.dataset.landscapeMotion==='reduced';
    },'Choose reduced motion');
  });

  await h.scenario('scene time presets, lock, live time, and close',sceneFixture(),async ui=>{
    await ui.act('settings',()=>!!document.querySelector('#modalRoot .settings-section'));
    await ui.act('scene-time-settings',()=>document.getElementById('sceneTimeDialog')?.open===true,'#modalRoot [data-act="scene-time-settings"]');
    for(const preset of ['00:00','12:00','first-light','sunrise','sunset','last-light']){
      await ui.click(`[data-scene-preset="${preset}"]`,scenePresetExpectation(preset),`Choose scene preset ${preset}`);
    }
    await ui.fill('#sceneTimeInput','21:15');
    await ui.select('#sceneSeasonInput','winter');
    await ui.click('#sceneTimeDialog [data-scene-time="lock"]',()=>state.settings.scene.time==='21:15'
      && state.settings.scene.season==='winter'&&document.getElementById('sceneTimeDialog')?.open===true,'Lock scene time');
    await ui.click('#sceneTimeDialog [data-scene-time="live"]',()=>state.settings.scene.time===null
      && state.settings.scene.season===null&&document.getElementById('sceneTimeDialog')?.open===true,'Use live scene time');
    await ui.click('#sceneTimeDialog [data-scene-time="close"]',()=>document.getElementById('sceneTimeDialog')?.open===false,'Close scene time');
  });

  await h.scenario('location request, save name, reset, and close',sceneFixture(),async ui=>{
    await ui.act('settings',()=>!!document.querySelector('#modalRoot .settings-section'));
    await ui.act('location-settings',()=>document.getElementById('locationDialog')?.open===true,'#modalRoot [data-act="location-settings"]');
    await ui.click('#locationDialog [data-location-action="request"]',()=>document.getElementById('locationDialog')?.open===true
      && document.getElementById('locationCurrent')?.textContent==='Near New York, NY'
      && state.settings.scene.location?.enabled===true
      && state.settings.scene.location.latitude===40.7
      && state.settings.scene.location.longitude===-74,'Request location');
    await ui.fill('#locationName','Safety scenario sky');
    await ui.fill('#locationTimezone','America/Los_Angeles');
    await ui.click('#locationDialog [data-location-action="save-name"]',()=>document.getElementById('locationCurrent')?.textContent==='Safety scenario sky'
      && state.settings.scene.location?.label==='Safety scenario sky'
      && state.settings.scene.location?.timezone==='America/Los_Angeles','Save location name and time zone');
    await ui.click('#locationDialog [data-location-action="reset"]',()=>document.getElementById('locationCurrent')?.textContent==='Using the default sky. Enable location to make it yours.'
      && state.settings.scene.location===null,'Reset location');
    await ui.click('#locationDialog [data-location-action="close"]',()=>document.getElementById('locationDialog')?.open===false,'Close location settings');
  });

  await h.scenario('denied location request leaves the default sky',({...sceneFixture(),geoFail:true}),async ui=>{
    await ui.act('settings',()=>!!document.querySelector('#modalRoot .settings-section'));
    await ui.act('location-settings',()=>document.getElementById('locationDialog')?.open===true,'#modalRoot [data-act="location-settings"]');
    await ui.click('#locationDialog [data-location-action="request"]',()=>document.getElementById('locationDialog')?.open===true
      && document.getElementById('locationCurrent')?.textContent==='Using the default sky. Enable location to make it yours.'
      && /denied/i.test(document.getElementById('locationStatus')?.textContent||'')
      && state.settings.scene.location===null,'Denied location request');
    await ui.click('#locationDialog [data-location-action="close"]',()=>document.getElementById('locationDialog')?.open===false,'Close denied location settings');
  });

  await h.scenario('scene view enters and returns to the task view',sceneFixture(),async ui=>{
    await ui.click('#viewScene',()=>document.documentElement.classList.contains('viewing-scene')
      && document.getElementById('exitScene')?.hidden===false
      && document.querySelector('.wrap')?.inert===true,'Enter scene view');
    await ui.click('#exitScene',()=>!document.documentElement.classList.contains('viewing-scene')
      && document.getElementById('exitScene')?.hidden===true
      && document.querySelector('.wrap')?.inert===false,'Exit scene view');
  });

  await h.scenario('Help FAQ and changelog disclosures toggle and close',sceneFixture(),async ui=>{
    await ui.act('help',()=>!!document.querySelector('#modalRoot .help'));
    const count=await ui.page.locator('#modalRoot .help summary').count();
    if(count<2)throw new Error(`Expected rendered FAQ and changelog disclosures, found ${count}`);
    const labels=[];
    for(let index=0;index<count;index++){
      const selector=await ui.page.locator('#modalRoot .help summary').nth(index).evaluate(summary=>{
        const parts=[];
        for(let node=summary;node&&node.parentElement;node=node.parentElement){
          if(node.id){parts.unshift('#'+CSS.escape(node.id));break;}
          const siblings=[...node.parentElement.children].filter(sibling=>sibling.tagName===node.tagName);
          parts.unshift(node.tagName.toLowerCase()+':nth-of-type('+(siblings.indexOf(node)+1)+')');
        }
        return parts.join(' > ');
      });
      const label=(await ui.page.locator(selector).evaluate(summary=>summary.textContent.trim())).replace(/\s+/g,' ');
      labels.push(label);
      let open=await ui.page.locator(selector).evaluate(summary=>summary.parentElement.open);
      await ui.click(selector,disclosureExpectation(index,!open),`Toggle ${label} disclosure`);
      open=await ui.page.locator(selector).evaluate(summary=>summary.parentElement.open);
      await ui.click(selector,disclosureExpectation(index,!open),`Toggle ${label} disclosure again`);
    }
    for(const required of ['Quick start','Scene and appearance','Changelog']){
      if(!labels.some(label=>label.toLowerCase().includes(required.toLowerCase())))
        throw new Error(`Expected rendered help disclosure: ${required}`);
    }
    await ui.act('close-modal',()=>!document.querySelector('#modalRoot .modal'),'#modalRoot [data-act="close-modal"]');
  });

  await h.scenario('first-run Quick Start can be acknowledged',sceneFixture({seenQuickStart:false}),async ui=>{
    await ui.act('ok-quickstart',()=>state.seenQuickStart===true&&!document.querySelector('#modalRoot .modal'),'#modalRoot [data-act="ok-quickstart"]');
  });
}
