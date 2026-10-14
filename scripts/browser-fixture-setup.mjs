/* Resolve the expected first-run help through its native Close control.
   Call after choosing motion normally; an unrelated dialog is a fixture error. */
export async function resolveExpectedFirstRunHelp(page){
 const panel=page.locator('#modalRoot .mback .modal');
 if(!await panel.count())return false;
 const heading=page.locator('#modalRoot #faqsTitle'),quickStart=page.locator('#modalRoot details.help-faq summary').first();
 const title=await heading.count()? (await heading.innerText()).trim():'';
 const summary=await quickStart.count()? (await quickStart.innerText()).trim():'';
 if(title!=='FAQs / Changelog'||summary!=='Quick start')throw new Error(`Unexpected first-run panel: ${title||'unidentified dialog'} / ${summary||'no Quick start'}`);
 const close=page.locator('#modalRoot .modal button[data-act="close-modal"][aria-label="Close"]');
 if(await close.count()!==1)throw new Error('Expected Quick start panel has no unique native Close control');
 await close.click();return true;
}
