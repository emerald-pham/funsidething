/* Sync session (#2377): the one owner of what this device knows about its
   cloud copies and of whether a cloud reply counts as a Cloud acknowledgement.
   A plain script, loaded like cloud-store-v2.js, with no screen, timers or
   clock: the page creates one session and asks it. Ordering is by revision
   only; nothing here reads a time.

   Damage. Each backend read of the cloud copy reports here, whoever started it
   (sync, Retry sync, Review saved decisions, a file restore or a recovery's
   confirmation), as does the server-only repair, through the backend's one
   "cloudread" event, so no caller has to remember to report (#2358: one
   forgot). Reads of earlier recovery sources and a push's own checks do not
   report. When a read finds the copy this device's Cloud acknowledgement
   names damaged, the session saves the acknowledgement without that copy, and
   no read may skip downloading a copy a read found damaged until a healthy
   read of that account.

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
     acknowledgement   {get(): Ack|null, valid(ack: Ack): boolean,
                        save(next: Ack): Promise<boolean>}
                       Ack = {account, identity, revision, base}, as saved,
                       where base is the saved decision base and base.copy
                       names the published copy {generationId, hash} its bytes
                       are. get() is cheap. valid() checks that base is the
                       decision base of that account and revision, from the
                       base's version, ID and bytes alone; it parses the whole
                       board, so the session asks it at most once per read and
                       never for a reply.
     events            the window: the session listens for "cloudread"
     unsent()          optional (#2378): why this board's unsent change waits
                       (a hold such as "hold:editor", "hidden" or "pending"),
                       or null when nothing waits to be sent

   Settled (#2378). The page counts each sync step it starts or schedules with
   track(kind), from the moment the step is called or its timer set until it
   finishes or the timer is cleared. snapshot().settled is true only while no
   step runs and none is scheduled, so the page will do no more sync work on
   its own. Work that waits on something outside the page (a hold, a hidden
   page, a read this page still owes) is listed under waiting and is not
   pending. turn grows by one on every change. Only the test driver reads
   work, waiting, settled and turn: no page code does, and nothing is shown.
   The ledger is in memory only, and track() adds no timer and no await. */
(function(root){
  "use strict";

  const copyOf=copy=>typeof copy?.generationId==="string"&&copy.generationId&&typeof copy.hash==="string"&&/^[a-f0-9]{64}$/.test(copy.hash)
    ? {generationId:copy.generationId,hash:copy.hash} : null;
  const text=value=>typeof value==="string"&&value?value:null;
  // #2417: what the cloud holds is its active full copy plus the change
  // records it keeps (GLOSSARY: Change record). through is the sequence
  // number up to which the known copy includes them (0: only the full copy).
  const NOTHING_KNOWN=Object.freeze({payload:null,account:null,revision:null,through:null});
  const knownCopy=(payload,account,revision,through=0)=>Object.freeze({payload:typeof payload==="string"?payload:null,account,
    revision:Number.isSafeInteger(revision)?revision:null,through:Number.isSafeInteger(through)&&through>=0?through:0});

  // The closed list of sync work (#2378), so a misspelt kind throws instead of
  // going uncounted. Steps that run: a cloud read, a cloud write, a device save
  // and a recovery flow. Steps that are scheduled: the save and push debounces,
  // the live-revision and backup-conflict reads, the retry after a device save
  // recovers, the cloud retry backoff and #2339's device-save retry.
  const WORK_KINDS=new Set(["pull","push","device-save","recovery","save-debounce","push-debounce","live-pull","backup-pull",
    "recovery-retry","cloud-retry","device-save-retry"]);
  // #2407: a scanner answer's queued catch-up (its History, ranks, Undo seal,
  // and the device save and push it then asks for) is scheduled sync work.
  WORK_KINDS.add("answer-catch-up");
  // #2417: sending a change record (its device save and cloud write) and
  // applying the ones the cloud delivers are sync work too.
  WORK_KINDS.add("record-send");WORK_KINDS.add("record-apply");

  function createSyncSession({backend,identity,acknowledgement,events,unsent=null}={}){
    if(typeof backend!=="function"||typeof identity!=="function"||typeof acknowledgement?.get!=="function"||
      typeof acknowledgement.valid!=="function"||typeof acknowledgement.save!=="function")
      throw new TypeError("The sync session needs its backend, identity and acknowledgement ports.");
    const read=port=>{try{return port();}catch{return null;}};
    const connection=()=>read(backend)??null,account=()=>connection()?.user??null;
    const signedIn=()=>text(read(identity)),rawIdentity=()=>read(identity)??null;
    const acknowledged=()=>read(()=>acknowledgement.get())??null;
    const validates=ack=>read(()=>acknowledgement.valid(ack))===true;

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
    // #2378: the sync work now running or scheduled, and a count of changes.
    const work=new Set();
    let turn=0;
    function waiting(){
      const user=account(),list=[];
      if(!user)return list;
      const reason=typeof unsent==="function"?text(read(unsent)):null;
      if(reason!==null)list.push(Object.freeze({kind:"push",reason}));
      if(authority!==user)list.push(Object.freeze({kind:"read",reason:"read"}));
      return list;
    }
    function snapshot(){
      const id=signedIn(),record=id===null?null:damage.get(id)??null;
      const view={damaged:record?{...record}:null,authority,known,owner,writing:writer!==null,
        work:[...work].map(item=>Object.freeze({kind:item.kind,state:item.state})),waiting:null,settled:work.size===0,turn};
      // Worked out when read, so the page's own listeners, which never read
      // it, pay nothing for it.
      Object.defineProperty(view,"waiting",{get:waiting,enumerable:true});
      return view;
    }
    function changed(){
      turn++;
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
    // read has found that copy damaged. These checks are cheap; whether the
    // base is valid, and the bytes, are checked after.
    function namedCopy(ack,user,id){
      const base=ack?.base,copy=copyOf(base?.copy);
      if(!copy||Array.isArray(base)||id===null||typeof user!=="string"||ack.account!==user||ack.identity!==id||
        !Number.isSafeInteger(ack.revision)||ack.revision<1||base.account!==ack.account||base.revision!==ack.revision||
        typeof base.payload!=="string"||knownDamaged(id,copy.generationId))return null;
      return {account:user,identity:id,rev:ack.revision,generationId:copy.generationId,hash:copy.hash,payload:base.payload,
        base:{v:base.v,id:base.id}};
    }
    // #2377 review N2: a proof stays a proof while the acknowledgement still
    // names it, field for field: the account, identity and revision, and the
    // base's version, ID, bytes and copy. valid() depends on nothing else, so
    // it is not asked again (a parse of the whole board), and the same base
    // object compares at once. An equal board saved again, as another tab's,
    // still names it. A damage report since takes the proof away (namedCopy).
    const stillNamed=proof=>{
      const now=namedCopy(acknowledged(),account(),signedIn());
      return !!now&&now.account===proof.account&&now.identity===proof.identity&&now.rev===proof.rev&&
        now.generationId===proof.generationId&&now.hash===proof.hash&&now.payload===proof.payload&&
        now.base.v===proof.base.v&&now.base.id===proof.base.id;
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
        const ack=acknowledged(),candidate=namedCopy(ack,reader,signedIn());
        try{if(candidate&&validates(ack)&&await root.ChainStorageV2.hashPayload(candidate.payload)===candidate.hash)proof=candidate;}
        catch{ /* No digest proves nothing; the read downloads in full. */ }
      }
      return {go:true,read:{
        get unchangedSince(){
          if(!open||!proof||!stillNamed(proof))return null;
          return {rev:proof.rev,generationId:proof.generationId,hash:proof.hash,payload:proof.payload};
        },
        accept({payload=null,revision=null,through=0}={}){
          if(!open)return false;
          before={authority,known};authority=reader;known=knownCopy(payload,reader,revision,through);changed();
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
        // belong to this ticket's connection and be an acknowledgement, and an
        // ordinary push's must not be older than this device's revision (a
        // replacing write checks the cloud with its own reads). Then the copy
        // is recorded and the owner bound, and install() saves the
        // acknowledged board (a plain save for an ordinary push; a recovery
        // flow's state install after its own head commit). They come first
        // because a device CAS repair that finishes during that save keeps the
        // confirmed revision only with the owner bound to it. A save that fails
        // or throws is not accepted (#2350): the copy and binding it made are
        // withdrawn, unless a sign-out, hide or newer read replaced them
        // meanwhile. bind:false is the saved-decisions Apply, which records
        // nothing and binds nothing (D7).
        async accept(reply,{payload=null,install=()=>true,bind=true,through=0}={}){
          if(!open)return {accepted:false,reason:"ended"};
          const settle=result=>{release();return result;};
          if(!current())return settle({accepted:false,reason:"obsolete",readRequired:obsolete()});
          if(!reply)return settle({accepted:false,reason:"unavailable"});
          if(reply.cancelled)return settle({accepted:false,reason:"cancelled"});
          if(reply.error)return settle({accepted:false,reason:"failed"});
          if(reply.conflict)return settle({accepted:false,reason:"conflict"});
          // Every backend sends a whole revision; a reply without one says
          // nothing (#2377 review N3: 2.5, NaN or Infinity used to be accepted).
          if(!Number.isSafeInteger(reply.rev))return settle({accepted:false,reason:"unavailable"});
          // An ordinary push never rewinds this device's revision or replaces a
          // newer copy with an older one. The saved revision alone decides; the
          // base is not checked. A replacing write confirms the cloud with its
          // own reads and may replace a board whose revision is above the
          // cloud's (a recreated cloud document), as before #2377 (specialist
          // review N4).
          if(ordinary&&reply.rev<acknowledged()?.revision)return settle({accepted:false,reason:"stale"});
          let before=null,made=null;
          if(bind){
            before={authority,known,owner};
            if(!ordinary)authority=ticket.account;
            known=knownCopy(payload,ticket.account,reply.rev,through);
            made={authority,known,owner:bindOwner()};
          }
          let installed=false,error=null;
          try{installed=await install()===true;}catch(caught){error=caught;}
          if(!installed){
            if(made){
              if(authority===made.authority)authority=before.authority;
              if(known===made.known)known=before.known;
              // Only a binding this acceptance made is withdrawn. When it
              // could bind none, a null owner may as well be a sign-out's or
              // a hide's, which must stand (#2377 review N3).
              if(made.owner!==null&&owner===made.owner)owner=before.owner;
              changed();
            }
            return settle({accepted:false,reason:"unsaved",...(error?{error}:{})});
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

    // #2417: a change record's send ticket. Records go up beside a full copy
    // and never wait for its write slot, but a record's reply is accepted with
    // a push reply's checks: it still belongs to the connection, identity,
    // owner binding and read authority its send started under, it is not
    // older than this device's revision, and install(), this device's own
    // note that the record it saved went up, succeeds. Acceptance adds
    // nothing to what the page knows the cloud holds: the record reaches the
    // known copy only when the cloud delivers it back (receive()).
    function mayRecord(){
      const cloud=connection();
      if(!cloud?.user||!cloud.ready)return {go:false,wait:"not-ready"};
      if(authority!==cloud.user)return {go:false,wait:"read"};
      const ticket={backend:cloud,account:cloud.user,identity:rawIdentity(),owner};
      let open=true;
      const current=()=>{
        const now=connection();
        return now===ticket.backend&&now.user===ticket.account&&rawIdentity()===ticket.identity&&!!now.ready&&
          owner===ticket.owner&&authority===ticket.account;
      };
      const send={...ticket,current,
        async accept(reply,{install=()=>true}={}){
          if(!open)return {accepted:false,reason:"ended"};
          open=false;
          if(!current())return {accepted:false,reason:"obsolete"};
          if(!reply)return {accepted:false,reason:"unavailable"};
          if(reply.cancelled)return {accepted:false,reason:"cancelled"};
          if(reply.unsupported)return {accepted:false,reason:"unsupported"};
          if(reply.error)return {accepted:false,reason:"failed"};
          if(!Number.isSafeInteger(reply.seq)||reply.seq<1||!Number.isSafeInteger(reply.rev))return {accepted:false,reason:"unavailable"};
          if(reply.rev<acknowledged()?.revision)return {accepted:false,reason:"stale"};
          let installed=false,error=null;
          try{installed=await install()===true;}catch(caught){error=caught;}
          if(!installed)return {accepted:false,reason:"unsaved",...(error?{error}:{})};
          return {accepted:true,seq:reply.seq,revision:reply.rev};
        },
        end(){open=false;},
      };
      return {go:true,send};
    }
    // #2417: the change records the cloud delivered, applied over the copy
    // this page knew, are now what it knows the cloud holds: the same
    // payload and revision moved on to through. Only over the known copy of
    // this account and revision, and only forward.
    function receive({payload,revision,through}={}){
      const user=account();
      if(!user||authority!==user||known.account!==user||known.revision!==revision||typeof payload!=="string"||
        !Number.isSafeInteger(through)||through<=(known.through??0))return false;
      known=knownCopy(payload,user,revision,through);changed();
      return true;
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
    // #2378: count one sync step. It is scheduled from now; run(promise) marks
    // it running and returns that same promise, ending the step when it
    // settles either way, so callers await exactly what they awaited before;
    // a value that is not a promise ends it at once. end() clears a step that
    // will not run. A step that starts the next one counts it before its own
    // promise settles, so settled never turns true between the two.
    function track(kind){
      if(!WORK_KINDS.has(kind))throw new TypeError("Unknown sync work: "+kind);
      const item={kind,state:"scheduled"};
      work.add(item);changed();
      const end=()=>{if(work.delete(item))changed();};
      return {
        run(step){
          if(!work.has(item))return step;
          if(typeof step?.then!=="function"){end();return step;}
          item.state="running";changed();
          step.then(end,end);
          return step;
        },
        end,
      };
    }
    return {startRead,observeRead,mayPush,mayRecord,receive,bindOwner,requireRead,snapshot,onChange,track};
  }

  root.ChainSyncSession={createSyncSession};
})(globalThis);
