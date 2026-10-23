/* Large boards and their recovery copies need a transactional browser store.
   Keep this module independent of the scanner UI so migration can prove and
   read back durable bytes before the app changes storage authority. */
(function(root){
  "use strict";

  const SCHEMA_VERSION=2;
  const DEFAULT_TARGET_BYTES=256*1024;
  const textEncoder=new TextEncoder();
  const textDecoder=new TextDecoder("utf-8",{fatal:true});
  const bytes=value=>textEncoder.encode(String(value));
  const hex=array=>Array.from(new Uint8Array(array),value=>value.toString(16).padStart(2,"0")).join("");
  const digest=async value=>hex(await root.crypto.subtle.digest("SHA-256",value instanceof Uint8Array?value:bytes(value)));
  const hashPayload=async payload=>digest(bytes(payload));

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
    if(!Number.isSafeInteger(header.chunkCount)||header.chunkCount<1||chunks.length!==header.chunkCount)
      throw new Error("Snapshot chunk count mismatch");
    let payload="",total=0;
    for(let index=0;index<chunks.length;index++){
      const chunk=chunks[index];
      if(!chunk||chunk.index!==index||typeof chunk.text!=="string") throw new Error("Snapshot chunk order is corrupt");
      const data=bytes(chunk.text),actualHash=await digest(data);
      if(data.length!==chunk.byteLength||actualHash!==chunk.hash) throw new Error("Snapshot chunk hash or length mismatch");
      total+=data.length;payload+=chunk.text;
    }
    if(total!==header.byteLength||await digest(bytes(payload))!==header.hash) throw new Error("Snapshot hash or length mismatch");
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

  function createDeviceStore({indexedDB=root.indexedDB,crypto=root.crypto,dbName="chain-scanner-v2",openTimeoutMs=5000,encodeRecoveryValue=null}={}){
    if(!indexedDB) throw new Error("IndexedDB is unavailable");
    if(!crypto?.subtle) throw new Error("Web Crypto is unavailable");
    if(!Number.isFinite(openTimeoutMs)||openTimeoutMs<1) throw new Error("IndexedDB open timeout is invalid");
    let db=null;
    const sha=async value=>hex(await crypto.subtle.digest("SHA-256",bytes(value)));
    const storeNames=["meta","snapshots","backups","opaque"];

    async function open(){
      if(db) return api;
      const request=indexedDB.open(dbName,1);
      db=await new Promise((resolve,reject)=>{
        let settled=false;
        const finish=(fn,value)=>{if(settled)return;settled=true;clearTimeout(timer);fn(value);};
        const timer=setTimeout(()=>finish(reject,Object.assign(new Error("IndexedDB open timed out"),{name:"TimeoutError"})),openTimeoutMs);
        request.onupgradeneeded=()=>{
          const next=request.result;
          for(const name of storeNames) if(!next.objectStoreNames.contains(name)) next.createObjectStore(name);
        };
        request.onsuccess=()=>{
          if(settled){try{request.result?.close();}catch(e){}return;}
          finish(resolve,request.result);
        };
        request.onerror=()=>finish(reject,request.error||new Error("IndexedDB open failed"));
        request.onblocked=()=>finish(reject,Object.assign(new Error("IndexedDB open is blocked"),{name:"BlockedError"}));
      });
      return api;
    }
    const ensureOpen=()=>{if(!db) throw new Error("Device store is not open");};

    async function readRawExportSnapshot(){
      ensureOpen();
      const tx=db.transaction(storeNames,"readonly"),done=transactionDone(tx);
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
        throw error;
      }
    }

    async function readHead(){
      ensureOpen();
      const tx=db.transaction(["meta","snapshots"],"readonly");
      const done=transactionDone(tx);
      const [meta,snapshots]=await Promise.all([
        requestResult(tx.objectStore("meta").get("head")),
        requestResult(tx.objectStore("snapshots").getAll()),
      ]);
      await done;
      if(!meta) return null;
      if(typeof meta!=="object"||meta.schemaVersion!==SCHEMA_VERSION||typeof meta.hash!=="string"||!/^[0-9a-f]{64}$/.test(meta.hash))
        throw new Error("Durable device head format is unsupported");
      const snapshot=snapshots.find(row=>row?.hash===meta.hash);
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
      const tx=db.transaction(["meta","snapshots","backups"],"readwrite"),done=transactionDone(tx);
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
    async function listBackups(){
      ensureOpen();
      const tx=db.transaction(["backups","snapshots","opaque"],"readonly"),backupStore=tx.objectStore("backups"),snapshotStore=tx.objectStore("snapshots"),opaqueStore=tx.objectStore("opaque");
      const done=transactionDone(tx);
      const [rows,keys,snapshots,snapshotKeys,opaque,opaqueKeys]=await Promise.all([requestResult(backupStore.getAll()),requestResult(backupStore.getAllKeys()),
        requestResult(snapshotStore.getAll()),requestResult(snapshotStore.getAllKeys()),requestResult(opaqueStore.getAll()),requestResult(opaqueStore.getAllKeys())]),result=[];
      await done;
      const protectedRaw=protectedRawRowReader(opaqueKeys,opaque);
      for(const [index,row]of rows.entries()){
        if(!row||typeof row!=="object"||Array.isArray(row)||typeof row.id!=="string"||row.id!==keys[index]||typeof row.payloadHash!=="string"){
          if(protectedRaw("backups",keys[index],row))continue;
          throw new Error("Durable recovery row is corrupt or unprotected");
        }
        const at=snapshots.findIndex(candidate=>candidate?.hash===row.payloadHash),snapshot=snapshots[at];
        if(!snapshot||typeof snapshot.payload!=="string"||await sha(snapshot.payload)!==row.payloadHash){
          if(protectedRaw("backups",keys[index],row)&&(at<0||protectedRaw("snapshots",snapshotKeys[at],snapshot)))continue;
          throw new Error("Durable recovery snapshot is corrupt");
        }
        const {payloadHash,...visible}=row;result.push({...visible,payload:snapshot.payload});
      }
      return result.sort((a,b)=>(b.at||0)-(a.at||0)||String(a.id).localeCompare(String(b.id)));
    }

    async function listOpaqueArchives(){
      ensureOpen();
      const tx=db.transaction("opaque","readonly"),done=transactionDone(tx),store=tx.objectStore("opaque");
      const [rows,keys]=await Promise.all([requestResult(store.getAll()),requestResult(store.getAllKeys())]);
      await done;
      const protectedRaw=protectedRawRowReader(keys,rows),readable=rows.filter((row,index)=>{
        if(row&&Object.prototype.toString.call(row)==="[object Object]")return true;
        if(protectedRaw("opaque",keys[index],row))return false;
        throw new Error("Durable opaque recovery row is corrupt or unprotected");
      });
      const visible=readable.sort((a,b)=>(a.order||0)-(b.order||0)).map(({order,...row})=>row);
      return typeof root.structuredClone==="function" ? root.structuredClone(visible) : visible;
    }

    async function protectRecoverySource({expectedHash,key,raw}={}){
      ensureOpen();
      if(typeof expectedHash!=="string"||typeof key!=="string"||!key||typeof raw!=="string")return false;
      const tx=db.transaction(["meta","opaque"],"readwrite"),done=transactionDone(tx);
      const head=await requestResult(tx.objectStore("meta").get("head"));
      const store=tx.objectStore("opaque"),[existingKey,existing]=await Promise.all([requestResult(store.getKey(key)),requestResult(store.get(key))]);
      // A peer edit or different evidence at this identity invalidates the
      // capture. Recovery never replaces an earlier protected original.
      if(head?.hash!==expectedHash||existingKey!==undefined&&(existing?.key!==key||existing?.raw!==raw)){tx.abort();try{await done;}catch{}return false;}
      if(existingKey===undefined)store.put({key,raw,order:Date.now()},key);
      await done;
      return (await listOpaqueArchives()).some(row=>row.key===key&&row.raw===raw);
    }

    async function rawTransactionSnapshot(tx){
      const entries=await Promise.all(storeNames.map(async name=>{
        const store=tx.objectStore(name);
        const [keys,values]=await Promise.all([requestResult(store.getAllKeys()),requestResult(store.getAll())]);
        return [name,{keys,values}];
      }));
      return {stores:Object.fromEntries(entries)};
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
      const tx=db.transaction(storeNames,"readwrite"),done=transactionDone(tx);
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
          if(hold)tx.objectStore("meta").put({...hold,headHash:nextHash},"recoveryCloudHold");
          // Keep every unknown/orphan snapshot and pending record. The exact
          // overwritten metadata already lives in the immutable raw archive.
        }
        const snapshot=await rawTransactionSnapshot(tx);
        await done;
        if(payload===undefined)return {ok:true,snapshot};
        const head=await readHead();
        if(head?.hash!==nextHash||head?.payload!==payload)return {conflict:true,committedHash:nextHash,head};
        return {ok:true,hash:nextHash,head};
      }catch(error){try{tx.abort();}catch{}try{await done;}catch{}throw error;}
    }
    async function getRecoveryCloudHold(){
      ensureOpen();const tx=db.transaction("meta","readonly"),done=transactionDone(tx);
      const hold=await requestResult(tx.objectStore("meta").get("recoveryCloudHold"));await done;return hold??null;
    }
    async function clearRecoveryCloudHold({expectedHeadHash,expectedHead,encodeHead=pendingJSON,expectedHold,encodeHold=pendingJSON}={}){
      ensureOpen();if(typeof expectedHeadHash!=="string"||!expectedHold)return false;
      const tx=db.transaction("meta","readwrite"),done=transactionDone(tx),store=tx.objectStore("meta");
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

    async function migrateLegacy(legacy){
      ensureOpen();
      if(!legacy||typeof legacy.headPayload!=="string") return {error:true,code:"invalid-legacy-head"};
      const headHash=await sha(legacy.headPayload),prepared=[];
      for(const row of legacy.backups||[]){
        if(!row||typeof row.id!=="string"||typeof row.payload!=="string") return {error:true,code:"invalid-legacy-backup"};
        prepared.push({row:{...row,payloadHash:await sha(row.payload)},payload:row.payload});
      }
      const tx=db.transaction(storeNames,"readwrite"),metaStore=tx.objectStore("meta"),snapshotStore=tx.objectStore("snapshots"),backupStore=tx.objectStore("backups"),opaqueStore=tx.objectStore("opaque");
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

    async function commitHead({expectedHash,expectedHead,encodeHead=pendingJSON,payload,account=null,backup=null,backups=[],removeBackupIds=[]}={}){
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
      const tx=db.transaction(["meta","snapshots","backups"],"readwrite"),metaStore=tx.objectStore("meta"),snapshotStore=tx.objectStore("snapshots"),backupStore=tx.objectStore("backups");
      const [current,backupRows,snapshotKeys,recoveryHold,backupKeys]=await Promise.all([
        requestResult(metaStore.get("head")),requestResult(backupStore.getAll()),requestResult(snapshotStore.getAllKeys()),requestResult(metaStore.get("recoveryCloudHold")),
        requestResult(backupStore.getAllKeys()),
      ]);
      // A reviewed recovery head grants more authority than its payload hash.
      // Compare all original metadata inside the same transaction as the write.
      let sameHead=expectedHead===undefined;
      if(!sameHead)try{const expected=encodeHead(expectedHead),actual=encodeHead(current??null);sameHead=typeof expected==="string"&&typeof actual==="string"&&expected===actual;}catch{}
      if((current?.hash??null)!==(expectedHash??null)||!sameHead){
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
      for(const id of removeIds) backupStore.delete(id);
      for(const prepared of preparedBackups){
        snapshotStore.put({hash:prepared.payloadHash,payload:prepared.payload},prepared.payloadHash);
        const {payload:ignored,...saved}=prepared;backupStore.put(saved,saved.id);
      }
      snapshotStore.put({hash:nextHash,payload},nextHash);
      const committedHead={...current,hash:nextHash,account,schemaVersion:SCHEMA_VERSION,committedAt:Date.now()};
      metaStore.put(committedHead,"head");
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
      if(!recoveryHold)for(const key of snapshotKeys) if(!referenced.has(key)) snapshotStore.delete(key);
      await transactionDone(tx);
      const verified=await readHead();
      if(!verified) throw new Error("Device head verification failed");
      if(verified.hash!==nextHash){
        // The transaction above committed. A later CAS writer can advance the
        // live head before this separate verification read; report that exact
        // current head so its caller can reconcile instead of calling the
        // already-committed write a failure.
        return {ok:true,superseded:true,committedHash:nextHash,head:verified};
      }
      if(verified.payload!==payload) throw new Error("Device head verification failed");
      return {ok:true,hash:nextHash,...(expectedHead===undefined?{}:{committedHead:{...committedHead,payload}})};
    }

    async function putBackup({expectedHash,backup}={}){
      ensureOpen();
      if(!backup||typeof backup.id!=="string"||typeof backup.payload!=="string") return {error:true,code:"invalid-backup"};
      const payloadHash=await sha(backup.payload);
      const tx=db.transaction(["meta","snapshots","backups"],"readwrite"),done=transactionDone(tx);
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
      const verified=(await listBackups()).find(row=>row.id===backup.id);
      if(!verified||verified.payload!==backup.payload) throw new Error("Device recovery verification failed");
      return {ok:true,row:verified};
    }

    async function updateBackupKind(id,payload,kind){
      ensureOpen();
      if(typeof id!=="string"||typeof payload!=="string"||typeof kind!=="string") return false;
      const payloadHash=await sha(payload),tx=db.transaction("backups","readwrite"),done=transactionDone(tx),store=tx.objectStore("backups");
      const row=await requestResult(store.get(id));
      if(!row||row.payloadHash!==payloadHash){tx.abort();try{await done;}catch(e){}return false;}
      store.put({...row,kind},id);await done;return true;
    }

    async function deleteBackup(id,{payload,allowedKinds=[],beforeDelete=null}={}){
      ensureOpen();
      const payloadHash=typeof payload==="string"?await sha(payload):null;
      const tx=db.transaction(["meta","snapshots","backups"],"readwrite"),done=transactionDone(tx),store=tx.objectStore("backups"),snapshotStore=tx.objectStore("snapshots");
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
      const tx=db.transaction("meta","readonly"),done=transactionDone(tx),value=await requestResult(tx.objectStore("meta").get(pendingKey(account)));
      await done;return value||null;
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
      const tx=db.transaction("meta","readwrite"),done=transactionDone(tx),store=tx.objectStore("meta");
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
      const tx=db.transaction("meta","readwrite"),done=transactionDone(tx),store=tx.objectStore("meta"),current=await requestResult(store.get(pendingKey(account)));
      if(!current||current.generationId!==generationId){tx.abort();try{await done;}catch(e){}return false;}
      store.delete(pendingKey(account));await done;return true;
    }
    async function clearPendingUploadIfCurrent(account,expected,{guard}={}){
      ensureOpen();if(typeof account!=="string"||!account||typeof guard!=="function"||!expected)return false;
      let encoded;try{encoded=pendingJSON(expected);}catch{return false;}
      const tx=db.transaction("meta","readwrite"),done=transactionDone(tx),store=tx.objectStore("meta");
      const current=await requestResult(store.get(pendingKey(account)));let same=false;
      try{same=pendingJSON(current)===encoded&&guard()===true;}catch{}
      if(!same){tx.abort();try{await done;}catch{}return false;}
      store.delete(pendingKey(account));await done;return true;
    }
    async function setLegacyFingerprint(expectedHash,fingerprint){
      ensureOpen();if(typeof fingerprint!=="string"||!fingerprint)return false;
      const tx=db.transaction("meta","readwrite"),done=transactionDone(tx),store=tx.objectStore("meta"),current=await requestResult(store.get("head"));
      if(!current||current.hash!==expectedHash){tx.abort();try{await done;}catch(e){}return false;}
      store.put({...current,sourceFingerprint:fingerprint},"head");await done;return true;
    }

    async function close(){if(db){db.close();db=null;}}
    const api={open,close,readRawExportSnapshot,readHead,withCurrentHead,listBackups,listOpaqueArchives,protectRecoverySource,writeRecoveredSource,getRecoveryCloudHold,clearRecoveryCloudHold,clearRecoveryCloudHoldIfCurrent:clearRecoveryCloudHold,migrateLegacy,commitHead,commitHeadIfCurrent:commitHead,putBackup,
      updateBackupKind,deleteBackup,getPendingUpload,setPendingUpload,setPendingUploadIfCurrent,clearPendingUpload,clearPendingUploadIfCurrent,setLegacyFingerprint};
    return api;
  }

  root.ChainStorageV2={SCHEMA_VERSION,DEFAULT_TARGET_BYTES,hashPayload,encodeSnapshot,decodeSnapshot,createDeviceStore};
})(globalThis);
