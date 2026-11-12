/* Large boards and their recovery copies need a transactional browser store.
   Keep this module independent of the scanner UI so migration can prove and
   read back durable bytes before the app changes storage authority. */
(function(root){
  "use strict";

  const SCHEMA_VERSION=2;
  const DEFAULT_TARGET_BYTES=256*1024;
  // #2335: the keeper a redundant-copy proof names when the board the same
  // head commit writes holds the copy (see commitHead's removeRedundantBackups).
  const KEPT_BY_SAVED_BOARD="board";
  // #2254: the acknowledged recovery trim's plan (a meta row) and the rows it
  // can never delete (see beginRecoveryTrim).
  const RECOVERY_TRIM_KEY="recoveryTrim",RECOVERY_TRIM_MAX_KEYS=4096;
  const RECOVERY_TRIM_KEPT_PREFIXES=Object.freeze(["unreadable-generation-record:","device-recovery-original:","device-recovery-file:","cloud-generation-recovery:","cloud-generation-recovery-summary:"]);
  // #2281 review: a recovery archive's summary. Archives are kept forever and
  // never replaced, and the previous release copied every earlier prepared
  // choice into each one, so each was larger than the last. A save needs only
  // an archive's identity, manifest, generation ids and headers, and pending
  // upload, plus exact fingerprints of its cloud evidence to tell which
  // confirmed choice completes it; the whole archive only when its chunks are
  // sent for protection. The summary is derived from the archive under the
  // same key, so it stays true for as long as that archive exists.
  const CLOUD_RECOVERY_SUMMARY_FORMAT="chain-scanner.cloud-recovery-summary",CLOUD_RECOVERY_SUMMARY_PREFIX="cloud-generation-recovery-summary:";
  const cloudRecoverySummaryKey=archiveKey=>CLOUD_RECOVERY_SUMMARY_PREFIX+archiveKey;
  // The canonical text the cloud module's sameRecoveryValue compares: map field
  // order is ignored, arrays and every value stay exact. An absent value has no
  // text, so it gets a marker no JSON text can equal.
  const canonicalRecoveryJson=value=>{
    const ordered=item=>Array.isArray(item)?item.map(ordered):item&&typeof item==="object"
      ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,ordered(item[key])])):item;
    const raw=JSON.stringify(value);return raw===undefined?"\u0000undefined":JSON.stringify(ordered(JSON.parse(raw)));
  };
  // #2287 (owner, 2026-11-08): the one rule for a generation with nothing left
  // to recover, on every route. It was declared complete and zero chunks
  // arrived, so no marker can keep anything, no later read can find anything,
  // and the collector retires it once the root has moved past it. A generation
  // with some chunks left is not used either, but keeps its marker: no readable
  // data goes with it. A failed read leaves chunks null (unavailable), never
  // empty, and an upload still staging may yet receive its chunks.
  const provedUnusableGeneration=row=>Array.isArray(row?.chunks)&&row.chunks.length===0&&
    ["sealed","published"].includes(row.header?.state)&&Number.isSafeInteger(row.header?.chunkCount)&&row.header.chunkCount>=1;
  async function cloudRecoverySummary(archiveKey,archived){
    if(typeof archiveKey!=="string"||!archiveKey||!archived||typeof archived!=="object"||Array.isArray(archived))return null;
    // #2287 review: an archive's generation seen with zero chunks says so here
    // too, so a save decides without reading the archive whole or the server.
    const generations=Array.isArray(archived.generations)?archived.generations.map(row=>row&&typeof row==="object"?{id:row.id,header:row.header,...(provedUnusableGeneration(row)?{chunks:[]}:{})}:row):null;
    return {format:CLOUD_RECOVERY_SUMMARY_FORMAT,version:1,archiveKey,archiveFormat:archived.format,archiveVersion:archived.version,
      identity:archived.identity,manifest:archived.manifest,generations,
      evidence:{manifest:canonicalRecoveryJson(archived.manifest),generations:await hashPayload(canonicalRecoveryJson(archived.generations)),
        pending:canonicalRecoveryJson(archived.pending)}};
  }
  function validCloudRecoverySummary(summary,archiveKey){
    return !!summary&&typeof summary==="object"&&summary.format===CLOUD_RECOVERY_SUMMARY_FORMAT&&summary.version===1&&summary.archiveKey===archiveKey&&
      (summary.generations===null||Array.isArray(summary.generations))&&!!summary.evidence&&typeof summary.evidence.manifest==="string"&&
      typeof summary.evidence.generations==="string"&&/^[0-9a-f]{64}$/.test(summary.evidence.generations)&&typeof summary.evidence.pending==="string";
  }
  // Ephemeral aliases distinguish handles, including replacement store instances.
  let connectionSequence=0;
  const connectionNumbers=new WeakMap();
  const textEncoder=new TextEncoder();
  const textDecoder=new TextDecoder("utf-8",{fatal:true});
  const bytes=value=>textEncoder.encode(String(value));
  const hex=array=>Array.from(new Uint8Array(array),value=>value.toString(16).padStart(2,"0")).join("");
  const digest=async value=>hex(await root.crypto.subtle.digest("SHA-256",value instanceof Uint8Array?value:bytes(value)));
  const hashPayload=async payload=>digest(bytes(payload));
  // #2254 release review (B1): the rejections decodeSnapshot raises because the
  // chunks it was given do not match the header that describes them (a chunk
  // missing, out of place or altered, or a length or hash that differs). Only
  // these say something about the bytes. Anything else it can reject with,
  // such as a digest the browser could not compute, says nothing about them.
  const corruptSnapshots=new WeakSet();
  const corruptSnapshot=message=>{const error=new Error(message);corruptSnapshots.add(error);return error;};
  const isCorruptSnapshotError=error=>corruptSnapshots.has(error);

  async function encodeSnapshot(payload,{targetBytes=DEFAULT_TARGET_BYTES}={}){
    if(typeof payload!=="string") throw new TypeError("Snapshot payload must be a string");
    if(!Number.isSafeInteger(targetBytes)||targetBytes<1024) throw new RangeError("Snapshot target must be at least 1024 bytes");
    const source=bytes(payload),chunks=[];
    if(!source.length){
      chunks.push({index:0,text:"",byteLength:0,hash:await digest(source)});
    }else{
      for(let start=0;start<source.length;){
        let end=Math.min(start+targetBytes,source.length);
        // A Firestore chunk is text, so never split a UTF-8 sequence. The
        // byte at `end` is the first byte of the next chunk.
        while(end<source.length&&(source[end]&0xc0)===0x80) end--;
        if(end===start) throw new Error("Snapshot chunk boundary is invalid");
        const part=source.slice(start,end);
        chunks.push({index:chunks.length,text:textDecoder.decode(part),byteLength:part.length,hash:await digest(part)});
        start=end;
      }
    }
    return {schemaVersion:SCHEMA_VERSION,encoding:"utf8",byteLength:source.length,
      hash:await digest(source),chunkCount:chunks.length,chunks};
  }

  async function decodeSnapshot(header,providedChunks){
    if(!header||header.schemaVersion!==SCHEMA_VERSION||header.encoding!=="utf8") throw new Error("Unknown snapshot encoding");
    const chunks=Array.isArray(providedChunks)?providedChunks:[];
    if(!Number.isSafeInteger(header.chunkCount)||header.chunkCount<1)throw new Error("Snapshot chunk count mismatch");
    if(chunks.length!==header.chunkCount)throw corruptSnapshot("Snapshot chunk count mismatch");
    let payload="",total=0;
    for(let index=0;index<chunks.length;index++){
      const chunk=chunks[index];
      if(!chunk||chunk.index!==index||typeof chunk.text!=="string") throw corruptSnapshot("Snapshot chunk order is corrupt");
      const data=bytes(chunk.text),actualHash=await digest(data);
      if(data.length!==chunk.byteLength||actualHash!==chunk.hash) throw corruptSnapshot("Snapshot chunk hash or length mismatch");
      total+=data.length;payload+=chunk.text;
    }
    if(total!==header.byteLength||await digest(bytes(payload))!==header.hash) throw corruptSnapshot("Snapshot hash or length mismatch");
    return payload;
  }

  const requestResult=request=>new Promise((resolve,reject)=>{
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error("IndexedDB request failed"));
  });
  const transactionDone=transaction=>new Promise((resolve,reject)=>{
    transaction.oncomplete=()=>resolve();
    transaction.onerror=()=>reject(transaction.error||new Error("IndexedDB transaction failed"));
    transaction.onabort=()=>reject(transaction.error||new Error("IndexedDB transaction aborted"));
  });

  function createDeviceStore({indexedDB=root.indexedDB,crypto=root.crypto,dbName="chain-scanner-v2",openTimeoutMs=5000,encodeRecoveryValue=null,onRecovery=null}={}){
    if(!indexedDB) throw new Error("IndexedDB is unavailable");
    if(!crypto?.subtle) throw new Error("Web Crypto is unavailable");
    if(!Number.isFinite(openTimeoutMs)||openTimeoutMs<1) throw new Error("IndexedDB open timeout is invalid");
    let db=null,opening=null,reconnectAllowed=false,openEpoch=0,cancelOpen=null;
    const sha=async value=>hex(await crypto.subtle.digest("SHA-256",bytes(value)));
    const storeNames=["meta","snapshots","backups","opaque"];
    const recoveryNow=()=>typeof root.performance?.now==="function"?root.performance.now():Date.now();
    const observeRecovery=(status,error=null,deviceOperation="open",connection=db)=>{
      let name,message;try{name=error?.name;message=error?.message;}catch{}
      const code=name==="QuotaExceededError"?"quota-exhausted":name==="SecurityError"?"storage-denied":
        name==="TimeoutError"?"deadline-exceeded":error?"unavailable":"unknown";
      // Only fixed categories leave this boundary. Never retain a browser's
      // raw exception, which can contain database paths or saved values.
      let deviceErrorName="unknown",deviceErrorReason="unknown";
      try{
        if(["UnknownError","InvalidStateError","AbortError","SecurityError","QuotaExceededError","TransactionInactiveError","DataError","DataCloneError","NotFoundError","ConstraintError","ReadOnlyError","TimeoutError","BlockedError","VersionError"].includes(name))deviceErrorName=name;
        if(message==="Connection to Indexed Database server lost."||message==="Connection to Indexed Database server lost. Refresh the page to try again.")deviceErrorReason="connection-lost";
        else if(message==="The database connection is closing."||message==="The database connection is closed.")deviceErrorReason="connection-closing";
        else if(message==="Connection closed")deviceErrorReason="connection-closed";
        else if(message==="An internal error was encountered in the Indexed Database server")deviceErrorReason="internal-server-error";
        else if(message==="Attempt to get a record from database without an in-progress transaction"||message==="The transaction is inactive or finished.")deviceErrorReason="inactive-transaction";
      }catch{}
      try{if(typeof onRecovery==="function")onRecovery({status,code,deviceOperation,deviceErrorName,deviceErrorReason,
        deviceConnection:connection?connectionNumbers.get(connection):undefined});}catch{}
    };

    const cancelledOpen=()=>Object.assign(new Error("Device store opening was cancelled"),{name:"AbortError"});
    function openOnce(existingOnly,remainingMs,epoch){
      return new Promise((resolve,reject)=>{
        const request=indexedDB.open(dbName,1);
        let settled=false;
        const cancel=()=>finish(reject,cancelledOpen());
        const finish=(fn,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(cancelOpen===cancel)cancelOpen=null;fn(value);};
        const timer=setTimeout(()=>finish(reject,Object.assign(new Error("IndexedDB open timed out"),{name:"TimeoutError"})),remainingMs);
        cancelOpen=cancel;
        request.onupgradeneeded=()=>{
          if(settled||epoch!==openEpoch){try{request.transaction.abort();}catch{}if(!settled)finish(reject,cancelledOpen());return;}
          // Reconnection never creates an empty replacement for a database
          // that disappeared. Its former authority and sources stay held.
          if(existingOnly){try{request.transaction.abort();}catch{}finish(reject,new Error("The existing device database is unavailable"));return;}
          const next=request.result;
          for(const name of storeNames) if(!next.objectStoreNames.contains(name)) next.createObjectStore(name);
        };
        request.onsuccess=()=>{
          if(settled||epoch!==openEpoch){try{request.result?.close();}catch(e){}if(!settled)finish(reject,cancelledOpen());return;}
          const connection=request.result;
          if(connectionSequence<999999)connectionNumbers.set(connection,++connectionSequence);
          db=connection;reconnectAllowed=true;
          connection.onclose=()=>{if(db===connection){db=null;observeRecovery("unavailable",new Error("Connection closed"),"connection",connection);}};
          connection.onversionchange=()=>{if(db===connection)db=null;try{connection.close();}catch{}};
          finish(resolve,api);
        };
        request.onerror=()=>finish(reject,request.error||new Error("IndexedDB open failed"));
        request.onblocked=()=>finish(reject,Object.assign(new Error("IndexedDB open is blocked"),{name:"BlockedError"}));
      });
    }
    async function open(){
      if(db)return api;
      if(opening)return opening;
      const existingOnly=reconnectAllowed,deadline=recoveryNow()+openTimeoutMs,epoch=openEpoch;
      const pending=(async()=>{
        for(let attempt=0;attempt<2;attempt++){
          if(epoch!==openEpoch)throw cancelledOpen();
          observeRecovery("started");
          try{const result=await openOnce(existingOnly,Math.max(1,deadline-recoveryNow()),epoch);if(epoch!==openEpoch)throw cancelledOpen();observeRecovery("completed");return result;}
          catch(error){
            observeRecovery("failed",error);
            const remaining=deadline-recoveryNow();
            if(attempt||remaining<=1||!["UnknownError","InvalidStateError"].includes(error?.name))throw error;
            // Both opens share the original deadline. Quota, permissions,
            // blocked upgrades and uncertain writes never enter this retry.
            await new Promise(resolve=>setTimeout(resolve,Math.min(25,remaining/2)));
          }
        }
      })();
      opening=pending;
      try{return await pending;}finally{if(opening===pending)opening=null;}
    }
    const ensureOpen=()=>{if(!db&&!reconnectAllowed) throw new Error("Device store is not open");};
    function readonlyRequest(tx,operation,createRequest){
      try{return requestResult(createRequest());}
      catch(error){observeRecovery("failed",error,operation,tx.db);throw error;}
    }
    async function readonlyResults(tx,requests,operation){
      const done=transactionDone(tx);
      try{
        // Observe requests and completion together: a server failure can
        // abort requests before its transaction error becomes available.
        const [values]=await Promise.all([Promise.all(requests),done]);return values;
      }catch(error){
        try{tx.abort();}catch{}
        try{await done;}catch{}
        const failure=tx.error||error;
        // The server can reject reads before delivering connection.onclose.
        // Retire only this failed handle so the caller's bounded recheck opens
        // the existing database. Never replay a transaction or close a newer
        // connection when an older concurrent read finishes late.
        const retired=db===tx.db&&["UnknownError","InvalidStateError"].includes(failure?.name);
        if(retired){
          const connection=db;db=null;
          try{connection.close();}catch{}
        }
        observeRecovery(retired?"unavailable":"failed",failure,operation,tx.db);
        throw failure;
      }
    }
    async function beginTransaction(names,mode){
      ensureOpen();
      if(!db)await open();
      const connection=db;
      try{return connection.transaction(names,mode);}
      catch(error){
        observeRecovery("failed",error,"transaction",connection);
        // A synchronous creation failure issued no requests or mutation.
        // Reconnect once; never replay a started transaction's uncertain work.
        if(!["InvalidStateError","UnknownError"].includes(error?.name))throw error;
        if(db===connection)db=null;
        try{connection.close();}catch{}
        await open();
        const replacement=db;
        try{return replacement.transaction(names,mode);}
        catch(error){observeRecovery("failed",error,"transaction",replacement);throw error;}
      }
    }

    async function readRawExportSnapshot(){
      ensureOpen();
      const tx=await beginTransaction(storeNames,"readonly"),done=transactionDone(tx);
      try{
        const entries=await Promise.all(storeNames.map(async name=>{
          const store=tx.objectStore(name);
          const [keys,values]=await Promise.all([
            requestResult(store.getAllKeys()),requestResult(store.getAll()),
          ]);
          return [name,{keys,values}];
        }));
        await done;
        return {stores:Object.fromEntries(entries)};
      }catch(error){
        try{tx.abort();}catch(e){}
        try{await done;}catch(e){}
        observeRecovery("failed",error,"raw-snapshot",tx.db);
        throw error;
      }
    }

    // #2246: every row of the named stores, in key order, in one readonly
    // transaction, like readRawExportSnapshot(), but handed to visit.row one
    // at a time and synchronously (so the transaction stays active). The
    // repair export writes each row out and lets it go, holding about one
    // saved copy instead of every saved copy at once, which exceeded a phone's
    // memory with a large board. visit.store(name) precedes each store's rows
    // and visit.end(name,count) follows them. A visitor error aborts the read.
    async function readRawExportRows(names,visit){
      ensureOpen();
      if(!Array.isArray(names)||names.some(name=>!storeNames.includes(name)))throw new Error("Unknown device store");
      const tx=await beginTransaction(names,"readonly"),done=transactionDone(tx);
      let visitorFailed=false;
      const read=new Promise((resolve,reject)=>{
        const call=(fn,...args)=>{try{fn?.(...args);return true;}catch(error){visitorFailed=true;reject(error);return false;}};
        const next=index=>{
          if(index>=names.length){resolve();return;}
          const name=names[index];let count=0;
          if(!call(visit.store,name))return;
          const request=tx.objectStore(name).openCursor();
          request.onerror=()=>reject(request.error);
          request.onsuccess=()=>{
            const cursor=request.result;
            if(!cursor){if(call(visit.end,name,count))next(index+1);return;}
            if(!call(visit.row,name,cursor.primaryKey,cursor.value))return;
            count++;cursor.continue();
          };
        };
        try{next(0);}catch(error){reject(error);}
      });
      try{await read;await done;}
      catch(error){
        try{tx.abort();}catch(e){}
        try{await done;}catch(e){}
        if(!visitorFailed)observeRecovery("failed",error,"raw-snapshot",tx.db);
        throw error;
      }
    }

    // #2227 (spec #2224): only the named rows, in one readonly transaction,
    // shaped like readRawExportSnapshot() restricted to the rows present. A
    // recovery check that compares a few rows no longer reads every saved
    // archive (many times the board's size after a recovery) to find them.
    // #2239: {keysOnly} names stores whose rows are only looked up by key; each
    // present row's value is then undefined, so a check that a row is still
    // present does not read it (an archive is several times the board's size).
    // #2281: {keysOnly} may instead map a store to the keys only looked up, so
    // one transaction can read some rows of a store and only check others.
    async function readRawRows(request,{keysOnly=[]}={}){
      ensureOpen();
      const names=storeNames.filter(name=>Array.isArray(request?.[name]));
      if(!names.length)return {stores:{}};
      const tx=await beginTransaction(names,"readonly"),done=transactionDone(tx);
      try{
        const entries=await Promise.all(names.map(async name=>{
          const store=tx.objectStore(name),wanted=[...new Set(request[name])],keyOnly=Array.isArray(keysOnly)&&keysOnly.includes(name);
          const keyOnlyKeys=keysOnly&&!Array.isArray(keysOnly)&&Array.isArray(keysOnly[name])?new Set(keysOnly[name]):null;
          const rows=await Promise.all(wanted.map(key=>Promise.all([requestResult(store.getKey(key)),keyOnly||keyOnlyKeys?.has(key)?undefined:requestResult(store.get(key))])));
          const present=rows.filter(([key])=>key!==undefined);
          return [name,{keys:present.map(([key])=>key),values:present.map(([,value])=>value)}];
        }));
        await done;
        return {stores:Object.fromEntries(entries)};
      }catch(error){
        try{tx.abort();}catch(e){}
        try{await done;}catch(e){}
        observeRecovery("failed",error,"raw-snapshot",tx.db);
        throw error;
      }
    }

    // #2239: the meta and backup rows in full, and only the keys of the
    // snapshots and opaque archives. Shaped like readRawExportSnapshot() with
    // those two stores' values left empty, so a recovery attempt can check the
    // source it already read without reading every saved board and archive
    // again. It is not a full comparison: a snapshot can change under its key
    // (repairHeadSnapshot rewrites one under its hash; commitHead and
    // putBackup drop extra fields from one they write again). The full
    // comparison of the source inside writeRecoveredSource's transaction is
    // what catches that.
    async function readRawFingerprint(){
      ensureOpen();
      const tx=await beginTransaction(storeNames,"readonly"),done=transactionDone(tx);
      try{
        const entries=await Promise.all(storeNames.map(async name=>{
          const store=tx.objectStore(name),keysOnly=name==="snapshots"||name==="opaque";
          const [keys,values]=await Promise.all([requestResult(store.getAllKeys()),keysOnly?[]:requestResult(store.getAll())]);
          return [name,{keys,values}];
        }));
        await done;
        return {stores:Object.fromEntries(entries)};
      }catch(error){
        try{tx.abort();}catch(e){}
        try{await done;}catch(e){}
        observeRecovery("failed",error,"raw-snapshot",tx.db);
        throw error;
      }
    }

    // #2309: how many backups are stored, loading no row: a row can carry a
    // retained file's bytes, and a failing app must still open its Debug log.
    async function countBackups(){
      ensureOpen();
      const tx=await beginTransaction(["backups"],"readonly");
      const [count]=await readonlyResults(tx,[readonlyRequest(tx,"count-backups",()=>tx.objectStore("backups").count())],"count-backups");
      return count;
    }

    async function readHead(){
      ensureOpen();
      const tx=await beginTransaction(["meta","snapshots"],"readonly");
      // #2239 round 2: the head's snapshot is read by its key, which is the
      // hash it carries, in the same transaction as the head row, instead of
      // reading every saved snapshot (each a whole board) to find it. Only when
      // that key holds no snapshot with that hash are all snapshots read, in
      // the same transaction, and searched as before. Those later reads start
      // inside the head read's own promise, so one that fails as it starts
      // rejects that promise and readonlyResults records the failure once;
      // readonlyRequest would record it a second time.
      const metaRequest=readonlyRequest(tx,"head",()=>tx.objectStore("meta").get("head"));
      const snapshotRequest=metaRequest.then(meta=>{
        if(typeof meta?.hash!=="string")return undefined;
        return requestResult(tx.objectStore("snapshots").get(meta.hash)).then(row=>row?.hash===meta.hash?row:
          requestResult(tx.objectStore("snapshots").getAll()).then(rows=>rows.find(item=>item?.hash===meta.hash)));
      });
      const [meta,found]=await readonlyResults(tx,[metaRequest,snapshotRequest],"head");
      if(!meta) return null;
      if(typeof meta!=="object"||meta.schemaVersion!==SCHEMA_VERSION||typeof meta.hash!=="string"||!/^[0-9a-f]{64}$/.test(meta.hash))
        throw new Error("Durable device head format is unsupported");
      const snapshot=found;
      if(!snapshot||typeof snapshot.payload!=="string"||await sha(snapshot.payload)!==meta.hash)
        throw new Error("Durable device head is corrupt");
      return {...meta,payload:snapshot.payload};
    }

    async function withCurrentHead(expectedHash,visit){
      ensureOpen();
      if(typeof expectedHash!=="string"||!/^[0-9a-f]{64}$/.test(expectedHash)||typeof visit!=="function") return false;
      // Optional legacy retirement must see the head and recovery references
      // together. Keep peer head/reclassification writes queued until its
      // synchronous decision finishes; this operation never changes IDB data.
      const tx=await beginTransaction(["meta","snapshots","backups"],"readwrite"),done=transactionDone(tx);
      try{
        const [head,snapshot,backups]=await Promise.all([
          requestResult(tx.objectStore("meta").get("head")),
          requestResult(tx.objectStore("snapshots").get(expectedHash)),
          requestResult(tx.objectStore("backups").getAll()),
        ]);
        if(head?.hash!==expectedHash||snapshot?.hash!==expectedHash||typeof snapshot?.payload!=="string"||
           visit({...head,payload:snapshot.payload},backups.map(row=>({...row})))!==true){
          tx.abort();try{await done;}catch(e){}return false;
        }
        await done;return true;
      }catch(error){try{tx.abort();}catch(e){}try{await done;}catch(e){}throw error;}
    }

    function protectedRawRowReader(keys,values){
      // Interpreted lists may omit an unreadable auxiliary row only when an
      // exact lossless copy already exists durably. The original row stays
      // untouched; without the app's lossless encoder these readers stay strict.
      let originals=null;
      return (name,key,value)=>{
        if(typeof encodeRecoveryValue!=="function")return false;
        try{
          if(originals===null)originals=values.flatMap((row,index)=>{
            if(typeof keys[index]!=="string"||!keys[index].startsWith("device-recovery-original:")||row?.key!==keys[index]||typeof row.raw!=="string")return [];
            try{const source=JSON.parse(row.raw);return source?.format==="chain-scanner.device-recovery-source"&&source.formatVersion===1&&source.indexedDB?[source.indexedDB]:[];}catch{return [];}
          });
          const encodedKey=JSON.stringify(encodeRecoveryValue(key,"recovery "+name+" key")),encodedValue=JSON.stringify(encodeRecoveryValue(value,"recovery "+name+" value"));
          return originals.some(source=>Array.isArray(source[name])&&source[name].some(row=>
            JSON.stringify(row?.key)===encodedKey&&JSON.stringify(row?.value)===encodedValue));
        }catch{return false;}
      };
    }
    // #2281: the exact device recovery originals that may keep an unreadable
    // row, read only when a listing meets such a row. They are never trimmed
    // or replaced (RECOVERY_TRIM_KEPT_PREFIXES), so reading them after the
    // listing's own transaction sees the same originals it would have seen.
    async function protectedRawReaderFromOriginals(opaqueKeys){
      const keys=(opaqueKeys||[]).filter(key=>typeof key==="string"&&key.startsWith("device-recovery-original:"));
      const read=keys.length?await readRawRows({opaque:keys}):{stores:{opaque:{keys:[],values:[]}}};
      return protectedRawRowReader(read.stores.opaque?.keys??[],read.stores.opaque?.values??[]);
    }
    // #2281: each listed row's payload as this store verified it against its
    // hash. A caller that passes earlier rows back ({reuse}) lets a listing
    // keep that same payload text when the stored snapshot still equals it
    // exactly, instead of holding a second copy of every saved board. On the
    // phone each refresh held every prepared recovery choice twice.
    const verifiedBackupPayloads=new WeakMap();
    // Rows as listBackups returns them, keeping only what a listing shows: the
    // exact text and any retained file bytes stay in device storage.
    const backupRowFacts=(row,payloadHash,fact)=>{
      const {payload,payloadHash:unused,restoreFile,...visible}=row;
      if(restoreFile&&typeof restoreFile==="object"){const {bytesBase64,...kept}=restoreFile;visible.restoreFile=kept;}
      return {...visible,payloadHash,payloadChars:fact.chars,payloadFacts:fact.facts};
    };
    // #2310: every backup as identity and display facts, without its text.
    // Only a snapshot not yet in {facts} (the caller's map of hash to what its
    // bytes measured) is read, one at a time in its own transaction, then let
    // go; snapshots are immutable by hash, so a recorded measure stays true of
    // those bytes. {onFactsChanged} fires after each change, so a caller that
    // saves them makes lasting progress even if the page is killed part way
    // through a first listing. Rows of {textKinds} keep their verified text,
    // as listBackups returns them, for the few callers that must inspect it
    // synchronously. Exact text always comes from the snapshot (readBackups).
    async function listBackupFacts({describe=null,textKinds=[],facts=new Map(),onFactsChanged=null,measureLimit=Infinity}={}){
      ensureOpen();
      const tx=await beginTransaction(["backups","snapshots","opaque"],"readonly"),done=transactionDone(tx),backupStore=tx.objectStore("backups");
      const [rows,keys,snapshotKeys,opaqueKeys]=await Promise.all([requestResult(backupStore.getAll()),requestResult(backupStore.getAllKeys()),requestResult(tx.objectStore("snapshots").getAllKeys()),requestResult(tx.objectStore("opaque").getAllKeys())]);
      await done;
      const presentSnapshots=new Set(snapshotKeys),keepText=new Set(textKinds),result=[],current=new Set();
      let measured=0;
      const factsChanged=()=>{try{onFactsChanged?.();}catch{}};
      let protectedRaw=null;
      const isProtected=async(...args)=>(protectedRaw??=await protectedRawReaderFromOriginals(opaqueKeys))(...args);
      // A row whose snapshot is not stored under its hash takes the full scan,
      // which also finds a snapshot carrying that hash under another key.
      const scanned=rows.some(row=>row&&typeof row==="object"&&!Array.isArray(row)&&typeof row.payloadHash==="string"&&!presentSnapshots.has(row.payloadHash))
        ? new Map((await listBackups()).map(row=>[row.id,row])) : null;
      for(const [index,row]of rows.entries()){
        if(!row||typeof row!=="object"||Array.isArray(row)||typeof row.id!=="string"||row.id!==keys[index]||typeof row.payloadHash!=="string"){
          if(await isProtected("backups",keys[index],row))continue;
          throw new Error("Durable recovery row is corrupt or unprotected");
        }
        const hash=row.payloadHash;current.add(hash);
        // An opening needs only each row's identity. Past {measureLimit}, a board
        // not measured yet is listed as pending, for the caller to measure later.
        const unmeasured=!facts.has(hash)||facts.get(hash).facts?.incomplete===true&&row.kind!=="latest";
        if(unmeasured&&!scanned&&!keepText.has(row.kind)&&measured++>=measureLimit){result.push(backupRowFacts(row,hash,{chars:null,facts:{readable:true,pending:true}}));continue;}
        let payload;
        if(scanned){
          if(!scanned.has(row.id))continue;
          payload=scanned.get(row.id).payload;
        }else if(!facts.has(hash)||keepText.has(row.kind)||facts.get(hash).facts?.incomplete===true&&row.kind!=="latest"){
          const read=await beginTransaction(["backups","snapshots"],"readonly"),readDone=transactionDone(read);
          const [stillListed,snapshot]=await Promise.all([requestResult(read.objectStore("backups").getKey(row.id)),requestResult(read.objectStore("snapshots").get(hash))]);
          await readDone;
          // Removed since the rows were read: a later listing owns that change.
          if(stillListed===undefined)continue;
          if(typeof snapshot?.payload!=="string"||await sha(snapshot.payload)!==hash){
            if(await isProtected("backups",keys[index],row)&&await isProtected("snapshots",hash,snapshot))continue;
            throw new Error("Durable recovery snapshot is corrupt");
          }
          payload=snapshot.payload;
        }
        let fact=facts.get(hash);
        // Measured from an automatic latest copy, whose full description was
        // skipped, then needed by another row of the same board.
        if(!fact||fact.facts?.incomplete===true&&row.kind!=="latest"){
          let described;
          try{described=typeof describe==="function"?describe(payload,row):undefined;}catch{described={readable:false};}
          fact={chars:payload.length,facts:described&&typeof described==="object"?described:{}};
          facts.set(hash,fact);
          factsChanged();
        }
        if(keepText.has(row.kind)){const {payloadHash,...visible}=row;result.push({...visible,payload});}
        else result.push(backupRowFacts(row,hash,fact));
      }
      // The measures of a board no backup refers to any more are of no use.
      const stale=[...facts.keys()].filter(hash=>!current.has(hash));
      if(stale.length){for(const hash of stale)facts.delete(hash);factsChanged();}
      return result.sort((a,b)=>(b.at||0)-(a.at||0)||String(a.id).localeCompare(String(b.id)));
    }
    // #2310: the named backups with their exact text, verified against each
    // row's hash just as a full listing is, read by key and let go afterwards.
    async function readBackups(ids){
      ensureOpen();
      const wanted=[...new Set(Array.isArray(ids)?ids:[])];
      if(!wanted.length)return [];
      const tx=await beginTransaction(["backups","snapshots"],"readonly"),done=transactionDone(tx),backupStore=tx.objectStore("backups"),snapshotStore=tx.objectStore("snapshots");
      const found=await Promise.all(wanted.map(id=>requestResult(backupStore.get(id)).then(row=>{
        if(!row||typeof row!=="object"||typeof row.payloadHash!=="string")return {row};
        return requestResult(snapshotStore.get(row.payloadHash)).then(snapshot=>({row,snapshot}));
      })));
      await done;
      const result=[];
      for(const {row,snapshot} of found){
        if(!row)continue;
        // Anything unexpected takes the full scan, which keeps its own refusal
        // and its allowance for a row that exact originals protect.
        if(typeof row!=="object"||typeof row.payloadHash!=="string"||snapshot?.hash!==row.payloadHash||typeof snapshot.payload!=="string"||await sha(snapshot.payload)!==row.payloadHash){
          const named=new Set(wanted);
          return (await listBackups()).filter(item=>named.has(item.id));
        }
        const {payloadHash,...visible}=row;result.push({...visible,payload:snapshot.payload});
      }
      return result;
    }

    // #2281: the snapshots are read one at a time with a cursor in the same
    // readonly transaction as the backup rows, and only the opaque keys are
    // read: every saved archive (each several times the board's size after a
    // recovery, and once many times more) was read on every listing only to
    // find the rare unreadable row. {kinds} lists only the rows of those
    // kinds, reading only their snapshots; a malformed row is still refused.
    async function listBackups({kinds=null,reuse=null}={}){
      ensureOpen();
      const wantedKind=Array.isArray(kinds)?new Set(kinds):null;
      const reused=new Map();
      for(const row of Array.isArray(reuse)?reuse:[]){
        const verified=row&&typeof row==="object"?verifiedBackupPayloads.get(row):undefined;
        if(verified)reused.set(verified.hash,verified.payload);
      }
      const tx=await beginTransaction(["backups","snapshots","opaque"],"readonly"),backupStore=tx.objectStore("backups"),snapshotStore=tx.objectStore("snapshots"),opaqueStore=tx.objectStore("opaque");
      const done=transactionDone(tx);
      // Requests run in the order they are placed, so the backup rows arrive
      // before the first snapshot does and name the snapshots worth keeping.
      const rowsRequest=backupStore.getAll();let wanted=null;
      rowsRequest.addEventListener("success",()=>{
        const rows=rowsRequest.result;
        if(Array.isArray(rows))wanted=new Set(rows.filter(row=>row&&typeof row==="object"&&(!wantedKind||wantedKind.has(row.kind))).map(row=>row.payloadHash));
      });
      const snapshots=new Map();
      const snapshotsRead=new Promise((resolve,reject)=>{
        const request=snapshotStore.openCursor();
        request.onerror=()=>reject(request.error||new Error("IndexedDB request failed"));
        request.onsuccess=()=>{
          const cursor=request.result;
          if(!cursor){resolve();return;}
          const value=cursor.value,hash=value&&typeof value==="object"?value.hash:undefined;
          // The first snapshot carrying a hash is the one a row names, as before.
          if(typeof hash==="string"&&!snapshots.has(hash)&&(wanted===null||wanted.has(hash))){
            const earlier=reused.get(hash);
            snapshots.set(hash,earlier!==undefined&&value.payload===earlier?{key:cursor.primaryKey,payload:earlier,verified:true}:{key:cursor.primaryKey,value,payload:value.payload,verified:false});
          }
          cursor.continue();
        };
      });
      const [rows,keys,,opaqueKeys]=await Promise.all([requestResult(rowsRequest),requestResult(backupStore.getAllKeys()),snapshotsRead,requestResult(opaqueStore.getAllKeys())]),result=[];
      await done;
      let protectedRaw=null;
      const isProtected=async(...args)=>(protectedRaw??=await protectedRawReaderFromOriginals(opaqueKeys))(...args);
      for(const [index,row]of rows.entries()){
        if(!row||typeof row!=="object"||Array.isArray(row)||typeof row.id!=="string"||row.id!==keys[index]||typeof row.payloadHash!=="string"){
          if(await isProtected("backups",keys[index],row))continue;
          throw new Error("Durable recovery row is corrupt or unprotected");
        }
        if(wantedKind&&!wantedKind.has(row.kind))continue;
        const snapshot=snapshots.get(row.payloadHash);
        if(!snapshot||typeof snapshot.payload!=="string"||!snapshot.verified&&await sha(snapshot.payload)!==row.payloadHash){
          if(await isProtected("backups",keys[index],row)&&(!snapshot||await isProtected("snapshots",snapshot.key,snapshot.value)))continue;
          throw new Error("Durable recovery snapshot is corrupt");
        }
        snapshot.verified=true;delete snapshot.value;
        const {payloadHash,...visible}=row,listed={...visible,payload:snapshot.payload};
        verifiedBackupPayloads.set(listed,{hash:payloadHash,payload:snapshot.payload});result.push(listed);
      }
      return result.sort((a,b)=>(b.at||0)-(a.at||0)||String(a.id).localeCompare(String(b.id)));
    }

    // #2239: {prefix} lists only the archives whose keys start with it, for a
    // caller that looks for one kind (a push checks its manual recovery
    // sources): it no longer reads every saved archive, several times the
    // board's size after an automatic recovery. A corrupt row in that range is
    // refused as an unprotected one is.
    async function listOpaqueArchives({prefix=null}={}){
      ensureOpen();
      const tx=await beginTransaction("opaque","readonly"),done=transactionDone(tx),store=tx.objectStore("opaque");
      let rows,keys,originalKeys=null,originals=null;
      if(typeof prefix==="string"&&prefix){
        const allKeys=await requestResult(store.getAllKeys());
        keys=allKeys.filter(key=>typeof key==="string"&&key.startsWith(prefix));
        rows=await Promise.all(keys.map(key=>requestResult(store.get(key))));
        // Release review of #2246/#2239: the exact originals that keep a
        // corrupt row lie outside the range, so they are read too, and only
        // when the range has such a row, to skip it as the full listing does
        // rather than refuse every push.
        if(rows.some(row=>!(row&&Object.prototype.toString.call(row)==="[object Object]"))){
          originalKeys=allKeys.filter(key=>typeof key==="string"&&key.startsWith("device-recovery-original:"));
          originals=await Promise.all(originalKeys.map(key=>requestResult(store.get(key))));
        }
      }else [rows,keys]=await Promise.all([requestResult(store.getAll()),requestResult(store.getAllKeys())]);
      await done;
      const protectedRaw=protectedRawRowReader(originalKeys??keys,originals??rows),readable=rows.filter((row,index)=>{
        if(row&&Object.prototype.toString.call(row)==="[object Object]")return true;
        if(protectedRaw("opaque",keys[index],row))return false;
        throw new Error("Durable opaque recovery row is corrupt or unprotected");
      });
      const visible=readable.sort((a,b)=>(a.order||0)-(b.order||0)).map(({order,...row})=>row);
      if(typeof root.structuredClone!=="function")return visible;
      // #2227 (spec #2224): the clone keeps its detached plain rows, but the
      // archive text itself is immutable and already this read's own copy, so
      // it is not copied a second time: that doubled every saved archive (many
      // times the board's size after a recovery) in memory. Each row's fields
      // keep their order.
      const cloned=root.structuredClone(visible.map(row=>typeof row.raw==="string"?{...row,raw:""}:row));
      cloned.forEach((row,index)=>{if(typeof visible[index].raw==="string")row.raw=visible[index].raw;});
      return cloned;
    }

    // #2281: the keys of the archives that start with {prefix}, without
    // reading any archive, and then one archive at a time by key. A push holds
    // one saved archive at once instead of all of them; the phone held every
    // earlier attempt's archive, each larger than the last. A malformed row is
    // skipped when an exact device recovery original keeps it and refused
    // otherwise, as listOpaqueArchives does.
    async function listOpaqueArchiveKeys({prefix}={}){
      ensureOpen();
      if(typeof prefix!=="string"||!prefix)throw new Error("An archive key prefix is required");
      const tx=await beginTransaction("opaque","readonly"),done=transactionDone(tx);
      const keys=await requestResult(tx.objectStore("opaque").getAllKeys());await done;
      return keys.filter(key=>typeof key==="string"&&key.startsWith(prefix));
    }
    async function readOpaqueArchive(key){
      ensureOpen();
      if(typeof key!=="string"||!key)return null;
      const read=await readRawRows({opaque:[key]}),at=read.stores.opaque.keys.indexOf(key);
      if(at<0)return null;
      const row=read.stores.opaque.values[at];
      if(row&&Object.prototype.toString.call(row)==="[object Object]"){const {order,...visible}=row;return visible;}
      const tx=await beginTransaction("opaque","readonly"),done=transactionDone(tx);
      const keys=await requestResult(tx.objectStore("opaque").getAllKeys());await done;
      if((await protectedRawReaderFromOriginals(keys))("opaque",key,row))return null;
      throw new Error("Durable opaque recovery row is corrupt or unprotected");
    }

    // #2281 review: an archive's summary, or null when it has none or its row
    // is not one this store wrote for that archive.
    async function readCloudRecoverySummary(archiveKey){
      ensureOpen();
      if(typeof archiveKey!=="string"||!archiveKey)return null;
      const key=cloudRecoverySummaryKey(archiveKey),read=await readRawRows({opaque:[key]}),at=read.stores.opaque.keys.indexOf(key);
      const row=at<0?null:read.stores.opaque.values[at];
      if(!row||row.key!==key||typeof row.raw!=="string")return null;
      let summary;try{summary=JSON.parse(row.raw);}catch{return null;}
      return validCloudRecoverySummary(summary,archiveKey)?summary:null;
    }
    // #2281 review: summaries for archives that have none, each derived from the
    // archive under its key. One transaction writes them all, only while the
    // head is the caller's and no recovery hold waits, only for archives that
    // exist, and never over a summary already saved.
    async function saveCloudRecoverySummaries({expectedHeadHash,summaries=[]}={}){
      ensureOpen();
      if(typeof expectedHeadHash!=="string"||!Array.isArray(summaries)||summaries.some(row=>!validCloudRecoverySummary(row,row?.archiveKey)))return {error:true,code:"invalid-recovery-summary"};
      const tx=await beginTransaction(["meta","opaque"],"readwrite"),done=transactionDone(tx),meta=tx.objectStore("meta"),opaque=tx.objectStore("opaque");
      try{
        const [head,holdKey]=await Promise.all([requestResult(meta.get("head")),requestResult(meta.getKey("recoveryCloudHold"))]);
        if(head?.hash!==expectedHeadHash||holdKey!==undefined){tx.abort();try{await done;}catch{}return {conflict:true};}
        const present=await Promise.all(summaries.map(row=>Promise.all([requestResult(opaque.getKey(row.archiveKey)),requestResult(opaque.getKey(cloudRecoverySummaryKey(row.archiveKey)))])));
        let written=0;
        summaries.forEach((row,index)=>{const [archive,summary]=present[index];
          if(archive===undefined||summary!==undefined)return;const key=cloudRecoverySummaryKey(row.archiveKey);
          opaque.put({key,raw:JSON.stringify(row),order:Date.now()},key);written++;});
        await done;return {ok:true,written};
      }catch(error){try{tx.abort();}catch{}try{await done;}catch{}throw error;}
    }

    async function protectRecoverySource({expectedHash,key,raw,summary=null}={}){
      ensureOpen();
      if(typeof expectedHash!=="string"||typeof key!=="string"||!key||typeof raw!=="string")return false;
      if(summary!==null&&!validCloudRecoverySummary(summary,key))return false;
      const tx=await beginTransaction(["meta","opaque"],"readwrite"),done=transactionDone(tx);
      const head=await requestResult(tx.objectStore("meta").get("head"));
      const store=tx.objectStore("opaque"),summaryKey=cloudRecoverySummaryKey(key);
      const [existingKey,existing,existingSummary]=await Promise.all([requestResult(store.getKey(key)),requestResult(store.get(key)),summary?requestResult(store.getKey(summaryKey)):undefined]);
      // A peer edit or different evidence at this identity invalidates the
      // capture. Recovery never replaces an earlier protected original.
      if(head?.hash!==expectedHash||existingKey!==undefined&&(existing?.key!==key||existing?.raw!==raw)){tx.abort();try{await done;}catch{}return false;}
      // #2281 review: the archive's summary is saved with it. A write that
      // aborts the transaction is waited for, so its failure is reported once.
      try{
        if(existingKey===undefined)store.put({key,raw,order:Date.now()},key);
        if(summary&&existingSummary===undefined)store.put({key:summaryKey,raw:JSON.stringify(summary),order:Date.now()},summaryKey);
      }catch(error){try{tx.abort();}catch{}try{await done;}catch{}throw error;}
      await done;
      // #2239: the protected row is read back once, alone, and compared exactly,
      // rather than read with every saved archive (several times the board's
      // size after a recovery).
      const readback=await readRawRows({opaque:[key]}),at=readback.stores.opaque?.keys?.indexOf(key)??-1;
      const saved=at<0?null:readback.stores.opaque.values[at];
      return !!saved&&Object.prototype.toString.call(saved)==="[object Object]"&&saved.key===key&&saved.raw===raw;
    }

    async function rawTransactionSnapshot(tx){
      const entries=await Promise.all(storeNames.map(async name=>{
        const store=tx.objectStore(name);
        const [keys,values]=await Promise.all([requestResult(store.getAllKeys()),requestResult(store.getAll())]);
        return [name,{keys,values}];
      }));
      return {stores:Object.fromEntries(entries)};
    }
    async function repairHeadSnapshot({expectedSource,encodeSource,payload,archive,guard=()=>true}={}){
      ensureOpen();
      if(typeof expectedSource!=="string"||typeof encodeSource!=="function"||typeof payload!=="string"||
        typeof guard!=="function"||typeof archive?.key!=="string"||!archive.key||typeof archive.raw!=="string")
        return {error:true,code:"invalid-recovery-source"};
      const hash=await sha(payload),tx=await beginTransaction(storeNames,"readwrite"),done=transactionDone(tx);
      try{
        const source=await rawTransactionSnapshot(tx),meta=tx.objectStore("meta"),snapshots=tx.objectStore("snapshots"),opaque=tx.objectStore("opaque");
        const head=source.stores.meta.values[source.stores.meta.keys.indexOf("head")];
        if(head?.schemaVersion!==SCHEMA_VERSION||head.hash!==hash||encodeSource(source)!==expectedSource||guard()!==true){
          tx.abort();try{await done;}catch{}return {conflict:true};
        }
        const [existingKey,existing]=await Promise.all([requestResult(opaque.getKey(archive.key)),requestResult(opaque.get(archive.key))]);
        if(existingKey!==undefined&&(existing?.key!==archive.key||existing?.raw!==archive.raw)){
          tx.abort();try{await done;}catch{}return {error:true,code:"recovery-evidence-collision"};
        }
        if(guard()!==true){tx.abort();try{await done;}catch{}return {conflict:true};}
        // Restore only the bytes named by the existing authority. Metadata,
        // holds, pending work and every other row retain their exact values.
        const previous=source.stores.snapshots.values[source.stores.snapshots.keys.indexOf(hash)];
        if(existingKey===undefined)opaque.put({...archive,order:Date.now()},archive.key);
        snapshots.put({...((previous&&Object.prototype.toString.call(previous)==="[object Object]")?previous:{}),hash,payload},hash);
        await done;
        const [verified,archives]=await Promise.all([readHead(),listOpaqueArchives()]);
        if(verified?.hash!==hash||verified.payload!==payload||!archives.some(row=>row.key===archive.key&&row.raw===archive.raw))
          return {conflict:true};
        return {ok:true,head:verified};
      }catch(error){try{tx.abort();}catch{}try{await done;}catch{}throw error;}
    }
    // Recovery compares the entire losslessly encoded raw source, including an
    // absent/malformed head and orphan rows. A hash-only CAS cannot distinguish
    // changes to corrupt bytes or preserve evidence it cannot interpret.
    async function writeRecoveredSource({expectedSource,encodeSource,archives=[],payload,account=null,sourceFingerprint=null,hold=null,guard=()=>true}={}){
      ensureOpen();
      if(typeof expectedSource!=="string"||typeof encodeSource!=="function"||typeof guard!=="function"||
         !Array.isArray(archives)||archives.some(row=>!row||typeof row.key!=="string"||!row.key||typeof row.raw!=="string"))
        return {error:true,code:"invalid-recovery-source"};
      if(payload!==undefined&&typeof payload!=="string")return {error:true,code:"invalid-payload"};
      const nextHash=payload===undefined?null:await sha(payload);
      const tx=await beginTransaction(storeNames,"readwrite"),done=transactionDone(tx);
      try{
        const source=await rawTransactionSnapshot(tx);
        if(encodeSource(source)!==expectedSource||guard()!==true){tx.abort();try{await done;}catch{}return {conflict:true};}
        const opaque=tx.objectStore("opaque");
        for(const row of archives){
          const [existingKey,existing]=await Promise.all([requestResult(opaque.getKey(row.key)),requestResult(opaque.get(row.key))]);
          if(existingKey!==undefined&&(!existing||existing.key!==row.key||existing.raw!==row.raw)){
            tx.abort();try{await done;}catch{}return {error:true,code:"recovery-evidence-collision"};
          }
          if(existingKey===undefined)opaque.put({key:row.key,raw:row.raw,order:Date.now()},row.key);
        }
        if(guard()!==true){tx.abort();try{await done;}catch{}return {conflict:true};}
        if(payload!==undefined){
          tx.objectStore("snapshots").put({hash:nextHash,payload},nextHash);
          tx.objectStore("meta").put({hash:nextHash,account,sourceFingerprint,schemaVersion:SCHEMA_VERSION,committedAt:Date.now()},"head");
          // #2254: a recovery that commits supersedes an unfinished trim; the
          // trim after its own acknowledgement plans again from what is left.
          if(hold){tx.objectStore("meta").put({...hold,headHash:nextHash},"recoveryCloudHold");tx.objectStore("meta").delete(RECOVERY_TRIM_KEY);}
          // Keep every unknown/orphan snapshot and pending record. The exact
          // overwritten metadata already lives in the immutable raw archive.
        }
        // #2227: only a write without a payload returns this in-transaction
        // view; a recovered head is verified by readHead() below instead.
        const snapshot=payload===undefined?await rawTransactionSnapshot(tx):null;
        await done;
        if(payload===undefined)return {ok:true,snapshot};
        const head=await readHead();
        if(head?.hash!==nextHash||head?.payload!==payload)return {conflict:true,committedHash:nextHash,head};
        return {ok:true,hash:nextHash,head};
      }catch(error){try{tx.abort();}catch{}try{await done;}catch{}throw error;}
    }
    async function getRecoveryCloudHold(){
      ensureOpen();const tx=await beginTransaction("meta","readonly");
      const [hold]=await readonlyResults(tx,[readonlyRequest(tx,"recovery-hold",()=>tx.objectStore("meta").get("recoveryCloudHold"))],"recovery-hold");return hold??null;
    }
    async function clearRecoveryCloudHold({expectedHeadHash,expectedHead,encodeHead=pendingJSON,expectedHold,encodeHold=pendingJSON}={}){
      ensureOpen();if(typeof expectedHeadHash!=="string"||!expectedHold)return false;
      const tx=await beginTransaction("meta","readwrite"),done=transactionDone(tx),store=tx.objectStore("meta");
      const [head,hold]=await Promise.all([requestResult(store.get("head")),requestResult(store.get("recoveryCloudHold"))]);
      // Recovery supplies its existing lossless source encoder. Legacy callers
      // stay strict: JSON-lossy unknown facts cannot authorize deleting a hold.
      let same=false;
      try{const expected=encodeHold(expectedHold),current=encodeHold(hold);same=typeof expected==="string"&&typeof current==="string"&&expected===current;}catch{}
      let sameHead=expectedHead===undefined;
      if(!sameHead)try{const expected=encodeHead(expectedHead),current=encodeHead(head??null);sameHead=typeof expected==="string"&&typeof current==="string"&&expected===current;}catch{}
      if(head?.hash!==expectedHeadHash||!same||!sameHead){
        tx.abort();try{await done;}catch{}return false;
      }
      store.delete("recoveryCloudHold");await done;return true;
    }

    // #2254 (owner direction, 2026-11-06): the only opaque delete. Once the
    // cloud has acknowledged a board, the app trims the archives its recoveries
    // left. beginRecoveryTrim saves the plan, the exact keys to delete, and
    // writes its notes in one transaction; continueRecoveryTrim then deletes a
    // bounded batch of the planned keys per transaction, by key, reading no
    // archive, so a page closed between batches leaves the rest planned for
    // the next opening. Neither runs while a recovery hold exists (the current
    // recovery may need any of its rows), on a head other than the caller's or
    // of another account, or for a key outside the plan. The plan can never
    // name the rows the device keeps: headers-only records of unreadable
    // generations, the device recovery originals (listBackups and
    // listOpaqueArchives rely on them to skip unreadable rows), exact file
    // restore bytes and the cloud retention receipts each push re-verifies.
    // writeRecoveredSource drops an unfinished plan when a recovery commits.
    const trimKeptPrefix=key=>RECOVERY_TRIM_KEPT_PREFIXES.some(prefix=>key.startsWith(prefix));
    function validRecoveryTrimPlan(plan){
      return !!plan&&typeof plan==="object"&&!Array.isArray(plan)&&plan.v===1&&(plan.account===null||typeof plan.account==="string")&&
        typeof plan.identity==="string"&&!!plan.identity&&Number.isSafeInteger(plan.revision)&&plan.revision>=0&&
        Array.isArray(plan.remaining)&&plan.remaining.length<=RECOVERY_TRIM_MAX_KEYS&&new Set(plan.remaining).size===plan.remaining.length&&
        plan.remaining.every(key=>typeof key==="string"&&!!key&&!trimKeptPrefix(key));
    }
    async function getRecoveryTrim(){
      ensureOpen();const tx=await beginTransaction("meta","readonly");
      const [plan]=await readonlyResults(tx,[readonlyRequest(tx,"recovery-trim",()=>tx.objectStore("meta").get(RECOVERY_TRIM_KEY))],"recovery-trim");
      return plan??null;
    }
    async function recoveryTrimTransaction(expectedHeadHash,visit){
      const tx=await beginTransaction(["meta","opaque"],"readwrite"),done=transactionDone(tx),meta=tx.objectStore("meta");
      try{
        const [head,holdKey,plan]=await Promise.all([requestResult(meta.get("head")),requestResult(meta.getKey("recoveryCloudHold")),
          requestResult(meta.get(RECOVERY_TRIM_KEY))]);
        const result=holdKey!==undefined?{held:true}:head?.hash!==expectedHeadHash?{conflict:true}:
          await visit({head,plan,meta,opaque:tx.objectStore("opaque")});
        if(!result?.ok){tx.abort();try{await done;}catch{}return result;}
        await done;return result;
      }catch(error){try{tx.abort();}catch{}try{await done;}catch{}throw error;}
    }
    async function beginRecoveryTrim({expectedHeadHash,plan,notes=[]}={}){
      ensureOpen();
      const notePrefix=validRecoveryTrimPlan(plan)?"automatic-recovery-note:"+encodeURIComponent(plan.identity)+":":null;
      if(typeof expectedHeadHash!=="string"||!notePrefix||!Array.isArray(notes)||notes.length>4||notes.some(row=>!row||
        typeof row.key!=="string"||!row.key.startsWith(notePrefix)||typeof row.raw!=="string"||row.raw.length>1048576||plan.remaining.includes(row.key)))
        return {error:true,code:"invalid-recovery-trim"};
      return recoveryTrimTransaction(expectedHeadHash,async({head,meta,opaque})=>{
        if((head.account??null)!==plan.account)return {conflict:true};
        for(const row of notes){
          const [key,existing]=await Promise.all([requestResult(opaque.getKey(row.key)),requestResult(opaque.get(row.key))]);
          if(key!==undefined&&(existing?.key!==row.key||existing?.raw!==row.raw))return {error:true,code:"recovery-evidence-collision"};
          if(key===undefined)opaque.put({key:row.key,raw:row.raw,order:Date.now()},row.key);
        }
        meta.put({v:1,account:plan.account,identity:plan.identity,revision:plan.revision,remaining:[...plan.remaining],startedAt:Date.now()},RECOVERY_TRIM_KEY);
        return {ok:true};
      });
    }
    async function continueRecoveryTrim({expectedHeadHash,limit=4}={}){
      ensureOpen();
      if(typeof expectedHeadHash!=="string"||!Number.isSafeInteger(limit)||limit<1||limit>64)return {error:true,code:"invalid-recovery-trim"};
      return recoveryTrimTransaction(expectedHeadHash,async({head,plan,meta,opaque})=>{
        if(plan===undefined)return {ok:true,done:true,deleted:[],remaining:0,noOp:true};
        if(!validRecoveryTrimPlan(plan))return {error:true,code:"invalid-recovery-trim"};
        if((head.account??null)!==plan.account)return {conflict:true};
        const deleted=plan.remaining.slice(0,limit),remaining=plan.remaining.slice(deleted.length);
        for(const key of deleted)opaque.delete(key);
        if(remaining.length)meta.put({...plan,remaining},RECOVERY_TRIM_KEY);else meta.delete(RECOVERY_TRIM_KEY);
        return {ok:true,done:!remaining.length,deleted,remaining:remaining.length};
      });
    }

    async function migrateLegacy(legacy){
      ensureOpen();
      if(!legacy||typeof legacy.headPayload!=="string") return {error:true,code:"invalid-legacy-head"};
      const headHash=await sha(legacy.headPayload),prepared=[];
      for(const row of legacy.backups||[]){
        if(!row||typeof row.id!=="string"||typeof row.payload!=="string") return {error:true,code:"invalid-legacy-backup"};
        prepared.push({row:{...row,payloadHash:await sha(row.payload)},payload:row.payload});
      }
      const tx=await beginTransaction(storeNames,"readwrite"),metaStore=tx.objectStore("meta"),snapshotStore=tx.objectStore("snapshots"),backupStore=tx.objectStore("backups"),opaqueStore=tx.objectStore("opaque");
      const existing=await requestResult(metaStore.get("head"));
      if(existing){
        tx.abort();
        try{await transactionDone(tx);}catch(e){}
        const head=await readHead();
        return {ok:true,verified:head?.hash===existing.hash,existing:true,hash:head?.hash};
      }
      snapshotStore.put({hash:headHash,payload:legacy.headPayload},headHash);
      for(const item of prepared){
        snapshotStore.put({hash:item.row.payloadHash,payload:item.payload},item.row.payloadHash);
        const {payload,...source}=item.row;backupStore.put(source,source.id);
      }
      for(const [order,row] of (legacy.opaqueArchives||[]).entries())
        opaqueStore.put({...row,order},`${order}:${String(row?.key||"")}`);
      metaStore.put({hash:headHash,account:legacy.account??null,sourceFingerprint:legacy.sourceFingerprint??null,
        schemaVersion:SCHEMA_VERSION,committedAt:Date.now()},"head");
      await transactionDone(tx);
      const [head,backups,opaque]=await Promise.all([readHead(),listBackups(),listOpaqueArchives()]);
      const exactBackups=(legacy.backups||[]).every(row=>backups.some(saved=>saved.id===row.id&&saved.payload===row.payload&&saved.kind===row.kind));
      const exactOpaque=JSON.stringify(opaque)===JSON.stringify(legacy.opaqueArchives||[]);
      return {ok:true,verified:head?.payload===legacy.headPayload&&head?.hash===headHash&&exactBackups&&exactOpaque,hash:headHash};
    }

    // releaseRecoveryHold deletes the exact expected recovery hold in the same
    // transaction as the head, so a crash cannot leave one without the other.
    async function commitHead({expectedHash,expectedHead,encodeHead=pendingJSON,payload,account=null,backup=null,backups=[],removeBackupIds=[],removeRedundantBackups=[],releaseRecoveryHold=null}={}){
      ensureOpen();
      if(typeof payload!=="string") return {error:true,code:"invalid-payload"};
      const nextHash=await sha(payload);
      const requested=[...(Array.isArray(backups)?backups:[]),...(backup?[backup]:[])],preparedBackups=[];
      const ids=new Set();
      for(const candidate of requested){
        if(!candidate||typeof candidate.id!=="string"||!candidate.id||typeof candidate.payload!=="string"||ids.has(candidate.id))
          return {error:true,code:"invalid-backup"};
        ids.add(candidate.id);preparedBackups.push({...candidate,payloadHash:await sha(candidate.payload)});
      }
      const tx=await beginTransaction(["meta","snapshots","backups"],"readwrite"),metaStore=tx.objectStore("meta"),snapshotStore=tx.objectStore("snapshots"),backupStore=tx.objectStore("backups");
      const [current,backupRows,snapshotKeys,recoveryHold,backupKeys]=await Promise.all([
        requestResult(metaStore.get("head")),requestResult(backupStore.getAll()),requestResult(snapshotStore.getAllKeys()),requestResult(metaStore.get("recoveryCloudHold")),
        requestResult(backupStore.getAllKeys()),
      ]);
      // A reviewed recovery head grants more authority than its payload hash.
      // Compare all original metadata inside the same transaction as the write.
      let sameHead=expectedHead===undefined;
      if(!sameHead)try{const expected=encodeHead(expectedHead),actual=encodeHead(current??null);sameHead=typeof expected==="string"&&typeof actual==="string"&&expected===actual;}catch{}
      let sameHold=!releaseRecoveryHold;
      if(!sameHold)try{const encode=releaseRecoveryHold.encodeHold||pendingJSON,expected=encode(releaseRecoveryHold.expectedHold),actual=encode(recoveryHold??null);
        sameHold=!!recoveryHold&&typeof expected==="string"&&typeof actual==="string"&&expected===actual;}catch{}
      if((current?.hash??null)!==(expectedHash??null)||!sameHead||!sameHold){
        tx.abort();try{await transactionDone(tx);}catch(e){}
        return {conflict:true,hash:current?.hash??null};
      }
      for(const prepared of preparedBackups){
        const at=backupKeys.indexOf(prepared.id),existing=backupRows[at];
        if(at>=0&&(!existing||existing.id!==prepared.id||existing.payloadHash!==prepared.payloadHash)){
          tx.abort();try{await transactionDone(tx);}catch(e){}
          return {error:true,code:"backup-id-collision"};
        }
      }
      const removeIds=new Set(Array.isArray(removeBackupIds)?removeBackupIds.filter(id=>typeof id==="string"&&id):[]);
      // #2335: copies the app proved redundant go only with this commit, and
      // none while a recovery hold is stored: recovery may still need them.
      // Each proof is rechecked here against the rows as they are now: the
      // copy still holds the bytes the app checked, and the row that keeps
      // those bytes ({keptBy:id}) is still there and stays. A copy proved
      // contained in the board being written ({keptBy:KEPT_BY_SAVED_BOARD})
      // needs only its bytes unchanged, since this transaction writes that board.
      let removedRedundant=0;
      if(!recoveryHold&&Array.isArray(removeRedundantBackups)){
        const rowById=new Map(backupRows.map(row=>[row?.id,row]));
        const proofs=removeRedundantBackups.filter(proof=>proof&&typeof proof.id==="string"&&proof.id&&!removeIds.has(proof.id)&&
          typeof proof.payloadHash==="string"&&rowById.get(proof.id)?.payloadHash===proof.payloadHash&&typeof proof.keptBy==="string");
        const removing=new Set(proofs.map(proof=>proof.id));
        for(const proof of proofs){
          if(proof.keptBy!==KEPT_BY_SAVED_BOARD){
            const keeper=rowById.get(proof.keptBy);
            if(!keeper||keeper.payloadHash!==proof.payloadHash||removeIds.has(keeper.id)||removing.has(keeper.id))continue;
          }
          removeIds.add(proof.id);removedRedundant++;
        }
      }
      // #2335: a write that throws part way aborts the whole transaction, so
      // the removals queued above never land without the head they go with.
      let committedHead;
      try{
        for(const id of removeIds) backupStore.delete(id);
        for(const prepared of preparedBackups){
          snapshotStore.put({hash:prepared.payloadHash,payload:prepared.payload},prepared.payloadHash);
          const {payload:ignored,...saved}=prepared;backupStore.put(saved,saved.id);
        }
        snapshotStore.put({hash:nextHash,payload},nextHash);
        committedHead={...current,hash:nextHash,account,schemaVersion:SCHEMA_VERSION,committedAt:Date.now()};
        metaStore.put(committedHead,"head");
        if(releaseRecoveryHold)metaStore.delete("recoveryCloudHold");
        // Snapshot payloads are immutable and shared by the live head and any
        // number of recovery references. Retire only blobs that will have no
        // reference after this transaction; interrupted commits keep the old
        // graph because IndexedDB rolls the whole transaction back.
        const nextBackupRows=backupRows.filter(row=>!removeIds.has(row?.id));
        for(const prepared of preparedBackups){
          const at=nextBackupRows.findIndex(row=>row?.id===prepared.id);
          if(at>=0)nextBackupRows[at]=prepared;else nextBackupRows.push(prepared);
        }
        const referenced=new Set(nextBackupRows.map(row=>row?.payloadHash));
        referenced.add(nextHash);
        // Unknown recovery rows remain in place while the recovered workspace
        // is awaiting a deliberate cloud choice, including during local edits.
        if(!recoveryHold)for(const key of snapshotKeys)if(!referenced.has(key)&&typeof key==="string"&&/^[a-f0-9]{64}$/.test(key)){
          const unused=await requestResult(snapshotStore.get(key));
          // Unknown rows can be sole recovery evidence after a damaged source
          // reopens. Retire only the two-field snapshots this codec owns.
          if(unused?.hash===key&&typeof unused.payload==="string"&&Object.keys(unused).length===2)
            snapshotStore.delete(key);
        }
      }catch(error){
        // Roll back everything queued above, then report the write's own error.
        try{tx.abort();}catch(e){}
        try{await transactionDone(tx);}catch(e){}
        throw error;
      }
      await transactionDone(tx);
      const verified=await readHead();
      if(!verified) throw new Error("Device head verification failed");
      if(verified.hash!==nextHash){
        // The transaction above committed. A later CAS writer can advance the
        // live head before this separate verification read; report that exact
        // current head so its caller can reconcile instead of calling the
        // already-committed write a failure.
        return {ok:true,superseded:true,committedHash:nextHash,head:verified,...(removedRedundant?{removedRedundant}:{})};
      }
      if(verified.payload!==payload) throw new Error("Device head verification failed");
      return {ok:true,hash:nextHash,...(removedRedundant?{removedRedundant}:{}),...(expectedHead===undefined?{}:{committedHead:{...committedHead,payload}})};
    }

    async function putBackup({expectedHash,backup}={}){
      ensureOpen();
      if(!backup||typeof backup.id!=="string"||typeof backup.payload!=="string") return {error:true,code:"invalid-backup"};
      const payloadHash=await sha(backup.payload);
      const tx=await beginTransaction(["meta","snapshots","backups"],"readwrite"),done=transactionDone(tx);
      const metaStore=tx.objectStore("meta"),snapshotStore=tx.objectStore("snapshots"),backupStore=tx.objectStore("backups");
      const [current,existing,existingKey]=await Promise.all([requestResult(metaStore.get("head")),requestResult(backupStore.get(backup.id)),requestResult(backupStore.getKey(backup.id))]);
      if((current?.hash??null)!==(expectedHash??null)){
        tx.abort();try{await done;}catch(e){}
        return {conflict:true,hash:current?.hash??null};
      }
      if(existingKey!==undefined&&(!existing||existing.id!==backup.id||existing.payloadHash!==payloadHash)){
        tx.abort();try{await done;}catch(e){}
        return {error:true,code:"backup-id-collision"};
      }
      snapshotStore.put({hash:payloadHash,payload:backup.payload},payloadHash);
      if(existingKey===undefined){const {payload,...saved}=backup;backupStore.put({...saved,payloadHash},saved.id);}
      await done;
      // #2281: the written row and its snapshot are read back by key and
      // compared exactly, rather than with every saved copy and archive.
      const readback=await readRawRows({backups:[backup.id],snapshots:[payloadHash]});
      const savedRow=readback.stores.backups.values[readback.stores.backups.keys.indexOf(backup.id)];
      const savedSnapshot=readback.stores.snapshots.values[readback.stores.snapshots.keys.indexOf(payloadHash)];
      if(!savedRow||typeof savedRow!=="object"||savedRow.id!==backup.id||savedRow.payloadHash!==payloadHash||
        savedSnapshot?.hash!==payloadHash||savedSnapshot.payload!==backup.payload) throw new Error("Device recovery verification failed");
      const {payloadHash:savedHash,...visible}=savedRow,verified={...visible,payload:backup.payload};
      verifiedBackupPayloads.set(verified,{hash:payloadHash,payload:backup.payload});
      return {ok:true,row:verified};
    }

    async function updateBackupKind(id,payload,kind){
      ensureOpen();
      if(typeof id!=="string"||typeof payload!=="string"||typeof kind!=="string") return false;
      const payloadHash=await sha(payload),tx=await beginTransaction("backups","readwrite"),done=transactionDone(tx),store=tx.objectStore("backups");
      const row=await requestResult(store.get(id));
      if(!row||row.payloadHash!==payloadHash){tx.abort();try{await done;}catch(e){}return false;}
      store.put({...row,kind},id);await done;return true;
    }

    async function deleteBackup(id,{payload,allowedKinds=[],beforeDelete=null}={}){
      ensureOpen();
      const payloadHash=typeof payload==="string"?await sha(payload):null;
      const tx=await beginTransaction(["meta","snapshots","backups"],"readwrite"),done=transactionDone(tx),store=tx.objectStore("backups"),snapshotStore=tx.objectStore("snapshots");
      try{
        const [row,head,rows]=await Promise.all([
          requestResult(store.get(id)),requestResult(tx.objectStore("meta").get("head")),requestResult(store.getAll()),
        ]);
        // A UI may also own an exact legacy mirror. Recheck its identity and
        // retire that reference synchronously while this transaction holds the
        // durable backup. A refused guard or failed commit keeps this copy.
        if(!row||(payloadHash&&row.payloadHash!==payloadHash)||(allowedKinds.length&&!allowedKinds.includes(row.kind))||
           (beforeDelete!==null&&(typeof beforeDelete!=="function"||beforeDelete({...row})!==true))){
          tx.abort();try{await done;}catch(e){}return false;
        }
        store.delete(id);
        if(head?.hash!==row.payloadHash&&!rows.some(other=>other.id!==id&&other.payloadHash===row.payloadHash))
          snapshotStore.delete(row.payloadHash);
        await done;return true;
      }catch(error){try{tx.abort();}catch(e){}try{await done;}catch(e){}throw error;}
    }

    const pendingKey=account=>"pending:"+account;
    async function getPendingUpload(account){
      ensureOpen();if(typeof account!=="string"||!account)return null;
      const tx=await beginTransaction("meta","readonly"),[value]=await readonlyResults(tx,[readonlyRequest(tx,"pending-upload",()=>tx.objectStore("meta").get(pendingKey(account)))],"pending-upload");
      return value||null;
    }
    function pendingJSON(value){
      const ancestors=new Set(),valid=value=>{
        if(value===null||typeof value==="string"||typeof value==="boolean"||typeof value==="number"&&Number.isFinite(value)&&!Object.is(value,-0))return true;
        if(!value||typeof value!=="object"||ancestors.has(value))return false;
        const array=Array.isArray(value),keys=Reflect.ownKeys(value);
        if(!array&&(Object.prototype.toString.call(value)!=="[object Object]"||Object.keys(value).length!==keys.length)||
          keys.some(key=>typeof key!=="string")||array&&(keys.length!==value.length+1||
            keys.some((key,index)=>key!==(index<value.length?String(index):"length"))))return false;
        ancestors.add(value);const supported=keys.every(key=>array&&key==="length"||valid(value[key]));ancestors.delete(value);return supported;
      };
      if(!valid(value))throw new TypeError("Pending source is not complete JSON");
      return JSON.stringify(value);
    }
    async function writePendingUpload(account,record,conditional=false,expected){
      ensureOpen();
      if(typeof account!=="string"||!account||!record||typeof record.generationId!=="string"||
         !/^[0-9a-f]{64}$/.test(record.payloadHash)||!Number.isSafeInteger(record.baseRev)||record.baseRev<0)
        return {error:true,code:"invalid-pending-upload"};
      let expectedJSON;
      if(conditional){
        if(expected!==null&&(!expected||typeof expected!=="object"||Array.isArray(expected)))return {error:true,code:"invalid-pending-expectation"};
        try{expectedJSON=pendingJSON(expected);}catch{return {error:true,code:"invalid-pending-expectation"};}
      }
      const value={generationId:record.generationId,payloadHash:record.payloadHash,baseRev:record.baseRev,
        updatedAt:Number.isFinite(record.updatedAt)?record.updatedAt:0,account};
      const tx=await beginTransaction("meta","readwrite"),done=transactionDone(tx),store=tx.objectStore("meta");
      try{
        if(conditional){
          const [key,current]=await Promise.all([requestResult(store.getKey(pendingKey(account))),requestResult(store.get(pendingKey(account)))]);
          let matches=expected===null?key===undefined:false;
          if(expected!==null&&key!==undefined)try{matches=pendingJSON(current)===expectedJSON;}catch{}
          if(!matches){tx.abort();try{await done;}catch{}return {conflict:true};}
        }
        store.put(value,pendingKey(account));await done;return {ok:true};
      }catch(error){try{tx.abort();}catch{}try{await done;}catch{}throw error;}
    }
    async function setPendingUpload(account,record){return writePendingUpload(account,record);}
    // An explicit capability keeps cached stores from silently ignoring a new
    // optional argument. Null means physical absence; an unknown row is present.
    async function setPendingUploadIfCurrent(account,record,expected){
      try{return await writePendingUpload(account,record,true,expected);}
      catch(error){return {error:true,code:"pending-upload-write-failed",...(error?.name==="QuotaExceededError"?{causeCode:"quota-exhausted"}:{})};}
    }
    async function clearPendingUpload(account,generationId){
      ensureOpen();if(typeof account!=="string"||!account)return false;
      const tx=await beginTransaction("meta","readwrite"),done=transactionDone(tx),store=tx.objectStore("meta"),current=await requestResult(store.get(pendingKey(account)));
      if(!current||current.generationId!==generationId){tx.abort();try{await done;}catch(e){}return false;}
      store.delete(pendingKey(account));await done;return true;
    }
    async function clearPendingUploadIfCurrent(account,expected,{guard}={}){
      ensureOpen();if(typeof account!=="string"||!account||typeof guard!=="function"||!expected)return false;
      let encoded;try{encoded=pendingJSON(expected);}catch{return false;}
      const tx=await beginTransaction("meta","readwrite"),done=transactionDone(tx),store=tx.objectStore("meta");
      const current=await requestResult(store.get(pendingKey(account)));let same=false;
      try{same=pendingJSON(current)===encoded&&guard()===true;}catch{}
      if(!same){tx.abort();try{await done;}catch{}return false;}
      store.delete(pendingKey(account));await done;return true;
    }
    async function setLegacyFingerprint(expectedHash,fingerprint){
      ensureOpen();if(typeof fingerprint!=="string"||!fingerprint)return false;
      const tx=await beginTransaction("meta","readwrite"),done=transactionDone(tx),store=tx.objectStore("meta"),current=await requestResult(store.get("head"));
      if(!current||current.hash!==expectedHash){tx.abort();try{await done;}catch(e){}return false;}
      store.put({...current,sourceFingerprint:fingerprint},"head");await done;return true;
    }

    async function close(){
      // Explicit shutdown revokes pending and late opens as well as the live
      // handle. A later explicit open owns a separate lifetime.
      openEpoch++;reconnectAllowed=false;cancelOpen?.();cancelOpen=null;opening=null;
      if(db){db.close();db=null;}
    }
    const api={open,close,readRawExportSnapshot,readRawExportRows,readRawFingerprint,readRawRows,readHead,withCurrentHead,countBackups,listBackups,listBackupFacts,readBackups,listOpaqueArchives,listOpaqueArchiveKeys,readOpaqueArchive,readCloudRecoverySummary,saveCloudRecoverySummaries,protectRecoverySource,repairHeadSnapshot,writeRecoveredSource,getRecoveryCloudHold,clearRecoveryCloudHold,clearRecoveryCloudHoldIfCurrent:clearRecoveryCloudHold,migrateLegacy,commitHead,commitHeadIfCurrent:commitHead,putBackup,
      updateBackupKind,deleteBackup,getPendingUpload,setPendingUpload,setPendingUploadIfCurrent,clearPendingUpload,clearPendingUploadIfCurrent,setLegacyFingerprint,
      getRecoveryTrim,beginRecoveryTrim,continueRecoveryTrim};
    return api;
  }

  root.ChainStorageV2={SCHEMA_VERSION,DEFAULT_TARGET_BYTES,KEPT_BY_SAVED_BOARD,hashPayload,encodeSnapshot,decodeSnapshot,isCorruptSnapshotError,createDeviceStore,
    canonicalRecoveryJson,cloudRecoverySummary,cloudRecoverySummaryKey,provedUnusableGeneration};
})(globalThis);
