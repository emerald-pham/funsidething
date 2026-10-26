// Nonmergeable diagnostic only: retain a finite tail from the real server logger.
export function installDiagnosticApiLog(report){
 const prior=process.stderr.write,previousDebug=process.env.DEBUG;
 const data=report.diagnosticApiLog={kind:'server-pw-api',maxEntries:128,maxEntryCharacters:512,entries:[],dropped:0,truncated:0};
 process.env.DEBUG='pw:api';
 process.stderr.write=function(chunk,...args){
  const text=String(chunk);
  if(!text.includes('pw:api'))return prior.call(this,chunk,...args);
  const clean=text.replace(/\u001b\[[0-9;]*m/g,'');
  if(data.entries.length===data.maxEntries){data.entries.shift();data.dropped++;}
  if(clean.length>data.maxEntryCharacters)data.truncated++;
  data.entries.push({at:Date.now(),text:clean.slice(0,data.maxEntryCharacters)});
  const callback=args.find(value=>typeof value==='function');if(callback)process.nextTick(callback);
  return true;
 };
 return()=>{process.stderr.write=prior;if(previousDebug===undefined)delete process.env.DEBUG;else process.env.DEBUG=previousDebug;};
}
