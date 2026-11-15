/* Sync session (#2377): the one owner of what this device knows about its
   cloud copies. A plain script, loaded like cloud-store-v2.js, with no screen,
   timers or clock: the page creates one session and asks it.

   This first part owns damage. Every cloud read reports here, whoever started
   it (sync, Retry sync, Review saved decisions, a file restore or the
   server-only repair), through the backend's one "cloudread" event, so no
   caller has to remember to report (#2358: one forgot). When a read finds the
   copy this device's Cloud acknowledgement names damaged, the session saves
   the acknowledgement without that copy, and no read may skip downloading a
   copy a read found damaged until a healthy read of that account.

   Ports:
     backend()         the cloud backend (window.CloudSync), for its account
     identity()        the signed-in identity (the backend's user ID)
     acknowledgement   {get(): Ack|null, save(next: Ack): Promise<boolean>}
                       Ack = {account, identity, revision, base}, where base
                       is the saved decision base and base.copy names the
                       published copy {generationId, hash} its bytes are
     events            the window: the session listens for "cloudread" */
(function(root){
  "use strict";

  const copyOf=copy=>typeof copy?.generationId==="string"&&copy.generationId&&typeof copy.hash==="string"&&/^[a-f0-9]{64}$/.test(copy.hash)
    ? {generationId:copy.generationId,hash:copy.hash} : null;
  const text=value=>typeof value==="string"&&value?value:null;

  function createSyncSession({backend,identity,acknowledgement,events}={}){
    if(typeof backend!=="function"||typeof identity!=="function"||typeof acknowledgement?.get!=="function"||typeof acknowledgement.save!=="function")
      throw new TypeError("The sync session needs its backend, identity and acknowledgement ports.");
    const read=port=>{try{return port();}catch{return null;}};
    const account=()=>read(()=>backend()?.user)??null,signedIn=()=>text(read(identity));
    const acknowledged=()=>read(()=>acknowledgement.get())??null;

    // One record per identity: the copy a read of that account last found
    // damaged. Kept for this page only; a healthy read of the account clears
    // it (#2377 D10). A record without a generation refuses every shortcut.
    const damage=new Map();
    // The save that drops a damaged copy from the acknowledgement. A second
    // report of the same copy joins it rather than saving again.
    let dropping=null;
    const listeners=new Set();
    function snapshot(){
      const id=signedIn(),record=id===null?null:damage.get(id)??null;
      return {damaged:record?{...record}:null};
    }
    function changed(){
      const view=snapshot();
      for(const listener of [...listeners]){try{listener(view);}catch{ /* A listener never stops the session. */ }}
    }
    function onChange(listener){
      if(typeof listener!=="function")return ()=>{};
      listeners.add(listener);return ()=>{listeners.delete(listener);};
    }
    const knownDamaged=(id,generationId)=>{
      const record=damage.get(id);
      return !!record&&(record.generationId===null||record.generationId===generationId);
    };

    // The acknowledged copy a read may treat as unchanged: this account and
    // identity's acknowledgement names a copy, at revision 1 or later, and no
    // read has found that copy damaged. The bytes are checked after.
    function namedCopy(ack,owner,id){
      const base=ack?.base,copy=copyOf(base?.copy);
      if(!copy||id===null||typeof owner!=="string"||ack.account!==owner||ack.identity!==id||
        !Number.isSafeInteger(ack.revision)||ack.revision<1||base.account!==ack.account||base.revision!==ack.revision||
        typeof base.payload!=="string"||knownDamaged(id,copy.generationId))return null;
      return {account:owner,identity:id,rev:ack.revision,generationId:copy.generationId,hash:copy.hash,payload:base.payload};
    }
    const stillNamed=proof=>{
      const now=namedCopy(acknowledged(),account(),signedIn());
      return !!now&&now.account===proof.account&&now.identity===proof.identity&&now.rev===proof.rev&&
        now.generationId===proof.generationId&&now.hash===proof.hash&&now.payload===proof.payload;
    };

    // #2354, D3: a read may skip downloading only the copy this device holds
    // exactly. Retry sync and signing in again (deliberate), and reads that
    // must download in full, never skip. unchangedSince is checked again each
    // time it is read, so damage reported while the read prepares takes it away.
    async function startRead({deliberate=false,full=false}={}){
      let proof=null;
      if(!deliberate&&!full){
        const candidate=namedCopy(acknowledged(),account(),signedIn());
        try{if(candidate&&await root.ChainStorageV2.hashPayload(candidate.payload)===candidate.hash)proof=candidate;}
        catch{ /* No digest proves nothing; the read downloads in full. */ }
      }
      let open=true;
      return {go:true,read:{
        get unchangedSince(){
          if(!open||!proof||!stillNamed(proof))return null;
          return {rev:proof.rev,generationId:proof.generationId,hash:proof.hash,payload:proof.payload};
        },
        end(){open=false;return {next:null};},
      }};
    }

    // A finished read's report: {user, identity, outcome: "damaged"|"healthy",
    // rev, generationId}. A thrown or offline read reports nothing (#2194 M1).
    // Damage is recorded before this returns, so a read that starts while the
    // acknowledgement is still saving cannot skip. A save that fails leaves
    // the damage known, so this page still never skips to that copy.
    function observeRead(report){
      const id=text(report?.identity);
      if(id===null||!["damaged","healthy"].includes(report.outcome))return Promise.resolve({saved:false});
      if(report.outcome==="healthy"){
        if(damage.delete(id))changed();
        return Promise.resolve({saved:false});
      }
      const generationId=text(report.generationId);
      const record={account:text(report.user),identity:id,rev:Number.isSafeInteger(report.rev)?report.rev:null,generationId};
      const prior=damage.get(id);
      if(!prior||prior.account!==record.account||prior.rev!==record.rev||prior.generationId!==record.generationId){damage.set(id,record);changed();}
      if(generationId===null)return Promise.resolve({saved:false});
      const same=dropping?.generationId===generationId?dropping:null,ack=acknowledged();
      if(same?.pending||!(ack?.base&&typeof ack.base==="object"&&ack.base.copy?.generationId===generationId))
        return same?same.promise:Promise.resolve({saved:false});
      // #2354 review: only the copy is dropped; the acknowledged board and
      // revision stay as they were.
      const {copy,...base}=ack.base;
      let saving;
      try{saving=Promise.resolve(acknowledgement.save({...ack,base}));}catch(error){saving=Promise.reject(error);}
      const drop={generationId,pending:true,promise:null};
      drop.promise=saving.then(saved=>({saved:saved===true}),()=>({saved:false})).finally(()=>{drop.pending=false;});
      dropping=drop;
      return drop.promise;
    }

    events?.addEventListener?.("cloudread",event=>{observeRead(event?.detail);});
    return {startRead,observeRead,snapshot,onChange};
  }

  root.ChainSyncSession={createSyncSession};
})(globalThis);
