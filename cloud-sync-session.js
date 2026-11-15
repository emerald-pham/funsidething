/* Sync session (#2377): the one owner of what this device knows about its
   cloud copies and of whether a cloud reply counts as a Cloud acknowledgement.
   A plain script, loaded like cloud-store-v2.js, with no screen, timers or
   clock: the page creates one session and asks it. Ordering is by revision
   only; nothing here reads a time.

   Damage. Every cloud read reports here, whoever started it (sync, Retry
   sync, Review saved decisions, a file restore or the server-only repair),
   through the backend's one "cloudread" event, so no caller has to remember to
   report (#2358: one forgot). When a read finds the copy this device's Cloud
   acknowledgement names damaged, the session saves the acknowledgement without
   that copy, and no read may skip downloading a copy a read found damaged
   until a healthy read of that account.

   Acknowledgements. The session holds what this page knows the cloud holds:
   read authority (the account whose cloud copy it read or published), the
   exact known cloud copy (payload, account and revision) and the Confirmed
   device cloud owner (GLOSSARY). A write ticket from mayPush captures the
   connection and owner a push starts under (Push response authority), and its
   accept() is the one place a reply is accepted as a Cloud acknowledgement.

   Ports:
     backend()         the cloud backend (window.CloudSync): its account, and
                       whether it is ready
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
  const NOTHING_KNOWN=Object.freeze({payload:null,account:null,revision:null});
  const knownCopy=(payload,account,revision)=>Object.freeze({payload:typeof payload==="string"?payload:null,account,
    revision:Number.isSafeInteger(revision)?revision:null});

  function createSyncSession({backend,identity,acknowledgement,events}={}){
    if(typeof backend!=="function"||typeof identity!=="function"||typeof acknowledgement?.get!=="function"||typeof acknowledgement.save!=="function")
      throw new TypeError("The sync session needs its backend, identity and acknowledgement ports.");
    const read=port=>{try{return port();}catch{return null;}};
    const connection=()=>read(backend)??null,account=()=>connection()?.user??null;
    const signedIn=()=>text(read(identity)),rawIdentity=()=>read(identity)??null;
    const acknowledged=()=>read(()=>acknowledgement.get())??null;

    // One record per identity: the copy a read of that account last found
    // damaged. Kept for this page only; a healthy read of the account clears
    // it (#2377 D10). A record without a generation refuses every shortcut.
    const damage=new Map();
    // The save that drops a damaged copy from the acknowledgement. A second
    // report of the same copy joins it rather than saving again.
    let dropping=null;
    // What this page knows the cloud holds (the page's reconciledAs,
    // lastKnownCloud* and confirmedCloudDeviceOwner before #2377).
    let authority=null,known=NOTHING_KNOWN,owner=null;
    // At most one write ticket is open at a time.
    let writer=null;
    const listeners=new Set();
    function snapshot(){
      const id=signedIn(),record=id===null?null:damage.get(id)??null;
      return {damaged:record?{...record}:null,authority,known,owner,writing:writer!==null};
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

    // The Confirmed device cloud owner: one process-local backend, account,
    // identity and revision binding, made only from an accepted read or
    // acknowledgement of this account whose exact payload and revision are
    // known. Anything else unbinds it. It keeps no board copy.
    function bindOwner(){
      const cloud=connection(),user=cloud?.user;
      owner=cloud&&cloud.ready&&user&&authority===user&&known.account===user&&Number.isSafeInteger(known.revision)&&typeof known.payload==="string"
        ?Object.freeze({backend:cloud,account:user,identity:rawIdentity(),revision:known.revision}):null;
      changed();return owner;
    }
    // The page's earlier read can no longer authorise writes (it hid, signed
    // out, or its board was replaced): read authority and the owner end. What
    // the cloud was last known to hold stays, for the next read to compare.
    function requireRead(reason){
      authority=null;owner=null;changed();
      return reason;
    }

    // The acknowledged copy a read may treat as unchanged: this account and
    // identity's acknowledgement names a copy, at revision 1 or later, and no
    // read has found that copy damaged. The bytes are checked after.
    function namedCopy(ack,user,id){
      const base=ack?.base,copy=copyOf(base?.copy);
      if(!copy||id===null||typeof user!=="string"||ack.account!==user||ack.identity!==id||
        !Number.isSafeInteger(ack.revision)||ack.revision<1||base.account!==ack.account||base.revision!==ack.revision||
        typeof base.payload!=="string"||knownDamaged(id,copy.generationId))return null;
      return {account:user,identity:id,rev:ack.revision,generationId:copy.generationId,hash:copy.hash,payload:base.payload};
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
    // accept() records what the read found for its account; revert() puts back
    // what the page knew before it, when the read's adoption is held.
    async function startRead({deliberate=false,full=false}={}){
      const reader=account();
      let proof=null,before=null,open=true;
      if(!deliberate&&!full){
        const candidate=namedCopy(acknowledged(),reader,signedIn());
        try{if(candidate&&await root.ChainStorageV2.hashPayload(candidate.payload)===candidate.hash)proof=candidate;}
        catch{ /* No digest proves nothing; the read downloads in full. */ }
      }
      return {go:true,read:{
        get unchangedSince(){
          if(!open||!proof||!stillNamed(proof))return null;
          return {rev:proof.rev,generationId:proof.generationId,hash:proof.hash,payload:proof.payload};
        },
        accept({payload=null,revision=null}={}){
          if(!open)return false;
          before={authority,known};authority=reader;known=knownCopy(payload,reader,revision);changed();
          return true;
        },
        revert(){
          if(!open||!before)return false;
          ({authority,known}=before);before=null;changed();
          return true;
        },
        end(){open=false;return {next:null};},
      }};
    }

    // A write ticket. An ordinary push writes over the copy this page read, so
    // it stays current only while the same connection, identity, owner binding
    // and read authority hold. A replacing write (a recovery publication, a file
    // restore or a saved-decisions Apply) verifies with its own fresh reads, so
    // only a changed connection or identity makes it obsolete. Neither may start
    // while another write is open or without a signed-in backend.
    function mayPush({replacing=false}={}){
      const cloud=connection(),ordinary=replacing!==true;
      if(!cloud?.user||ordinary&&!cloud.ready)return {go:false,wait:"not-ready"};
      if(writer)return {go:false,wait:"writing"};
      const ticket={backend:cloud,account:cloud.user,identity:rawIdentity(),owner,replacing:!ordinary};
      let open=true;
      const current=()=>{
        const now=connection();
        return now===ticket.backend&&now.user===ticket.account&&rawIdentity()===ticket.identity&&
          (!ordinary||!!now.ready&&owner===ticket.owner&&authority===ticket.account);
      };
      // An obsolete connection cannot schedule reads or writes for its
      // successor. Accepted work stays pending; while this ticket's owner
      // lifetime is still live, a fresh current-owner read must rebind it.
      const obsolete=()=>{
        let readRequired=false;
        if(ordinary){
          if(owner===ticket.owner&&account()===ticket.account&&rawIdentity()===ticket.identity&&authority===ticket.account){authority=null;readRequired=true;}
          if(owner===ticket.owner)owner=null;
          changed();
        }
        return readRequired;
      };
      const release=()=>{if(!open)return;open=false;if(writer===write)writer=null;changed();};
      const write={...ticket,current,
        // The one acceptance of a Cloud acknowledgement. The reply must still
        // belong to this ticket's connection, be an acknowledgement, and not
        // be older than this device's revision. install() then saves the
        // acknowledged board (a plain save for an ordinary push, the recovery
        // flow's head commit otherwise); a save that fails or throws is not
        // accepted (#2350), and the ticket must still be current after it.
        // Only then is the copy recorded and the owner bound. bind:false is
        // the saved-decisions Apply, which records without binding (D7).
        async accept(reply,{payload=null,install=()=>true,bind=true}={}){
          if(!open)return {accepted:false,reason:"ended"};
          const settle=result=>{release();return result;};
          const notCurrent=()=>settle({accepted:false,reason:"obsolete",readRequired:obsolete()});
          if(!current())return notCurrent();
          if(!reply)return settle({accepted:false,reason:"unavailable"});
          if(reply.cancelled)return settle({accepted:false,reason:"cancelled"});
          if(reply.error)return settle({accepted:false,reason:"failed"});
          if(reply.conflict)return settle({accepted:false,reason:"conflict"});
          if(typeof reply.rev!=="number")return settle({accepted:false,reason:"unavailable"});
          // Never rewind this device's revision or replace a newer copy with an older one.
          if(reply.rev<acknowledged()?.revision)return settle({accepted:false,reason:"stale"});
          let installed=false,error=null;
          try{installed=await install()===true;}catch(caught){error=caught;}
          if(!installed)return settle({accepted:false,reason:"unsaved",...(error?{error}:{})});
          if(!current())return notCurrent();
          if(bind){
            if(!ordinary)authority=ticket.account;
            known=knownCopy(payload,ticket.account,reply.rev);bindOwner();
          }
          return settle({accepted:true,revision:reply.rev});
        },
        end(outcome=null){
          if(!open)return {readRequired:false};
          const readRequired=outcome==="obsolete"&&obsolete();
          release();return {readRequired};
        },
      };
      writer=write;changed();
      return {go:true,write};
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
    return {startRead,observeRead,mayPush,bindOwner,requireRead,snapshot,onChange};
  }

  root.ChainSyncSession={createSyncSession};
})(globalThis);
