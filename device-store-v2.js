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

  function createDeviceStore({indexedDB=root.indexedDB,crypto=root.crypto,dbName="chain-scanner-v2",openTimeoutMs=5000}={}){
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
      const snapshot=snapshots.find(row=>row.hash===meta.hash);
      if(!snapshot||typeof snapshot.payload!=="string"||await sha(snapshot.payload)!==meta.hash)
        throw new Error("Durable device head is corrupt");
      return {...meta,payload:snapshot.payload};
    }

    async function listBackups(){
      ensureOpen();
      const tx=db.transaction(["backups","snapshots"],"readonly"),backupStore=tx.objectStore("backups"),snapshotStore=tx.objectStore("snapshots");
      const done=transactionDone(tx);
      const [rows,snapshots]=await Promise.all([requestResult(backupStore.getAll()),requestResult(snapshotStore.getAll())]),result=[];
      await done;
      for(const row of rows){
        const snapshot=snapshots.find(candidate=>candidate.hash===row.payloadHash);
        if(!snapshot||typeof snapshot.payload!=="string"||await sha(snapshot.payload)!==row.payloadHash)
          throw new Error("Durable recovery snapshot is corrupt");
        const {payloadHash,...visible}=row;result.push({...visible,payload:snapshot.payload});
      }
      return result.sort((a,b)=>(b.at||0)-(a.at||0)||String(a.id).localeCompare(String(b.id)));
    }

    async function listOpaqueArchives(){
      ensureOpen();
      const tx=db.transaction("opaque","readonly"),done=transactionDone(tx),rows=await requestResult(tx.objectStore("opaque").getAll());
      await done;
      const visible=rows.sort((a,b)=>(a.order||0)-(b.order||0)).map(({order,...row})=>row);
      return typeof root.structuredClone==="function" ? root.structuredClone(visible) : visible;
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

    async function commitHead({expectedHash,payload,account=null,backup=null,backups=[],removeBackupIds=[]}={}){
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
      const [current,backupRows,snapshotKeys]=await Promise.all([
        requestResult(metaStore.get("head")),requestResult(backupStore.getAll()),requestResult(snapshotStore.getAllKeys()),
      ]);
      if((current?.hash??null)!==(expectedHash??null)){
        tx.abort();try{await transactionDone(tx);}catch(e){}
        return {conflict:true,hash:current?.hash??null};
      }
      for(const prepared of preparedBackups){
        const existing=backupRows.find(row=>row.id===prepared.id);
        if(existing&&existing.payloadHash!==prepared.payloadHash){
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
      metaStore.put({...current,hash:nextHash,account,schemaVersion:SCHEMA_VERSION,committedAt:Date.now()},"head");
      // Snapshot payloads are immutable and shared by the live head and any
      // number of recovery references. Retire only blobs that will have no
      // reference after this transaction; interrupted commits keep the old
      // graph because IndexedDB rolls the whole transaction back.
      const nextBackupRows=backupRows.filter(row=>!removeIds.has(row.id));
      for(const prepared of preparedBackups){
        const at=nextBackupRows.findIndex(row=>row.id===prepared.id);
        if(at>=0)nextBackupRows[at]=prepared;else nextBackupRows.push(prepared);
      }
      const referenced=new Set(nextBackupRows.map(row=>row.payloadHash));
      referenced.add(nextHash);
      for(const key of snapshotKeys) if(!referenced.has(key)) snapshotStore.delete(key);
      await transactionDone(tx);
      const verified=await readHead();
      if(!verified||verified.hash!==nextHash||verified.payload!==payload) throw new Error("Device head verification failed");
      return {ok:true,hash:nextHash};
    }

    async function putBackup({expectedHash,backup}={}){
      ensureOpen();
      if(!backup||typeof backup.id!=="string"||typeof backup.payload!=="string") return {error:true,code:"invalid-backup"};
      const payloadHash=await sha(backup.payload);
      const tx=db.transaction(["meta","snapshots","backups"],"readwrite"),done=transactionDone(tx);
      const metaStore=tx.objectStore("meta"),snapshotStore=tx.objectStore("snapshots"),backupStore=tx.objectStore("backups");
      const [current,existing]=await Promise.all([requestResult(metaStore.get("head")),requestResult(backupStore.get(backup.id))]);
      if((current?.hash??null)!==(expectedHash??null)){
        tx.abort();try{await done;}catch(e){}
        return {conflict:true,hash:current?.hash??null};
      }
      if(existing&&existing.payloadHash!==payloadHash){
        tx.abort();try{await done;}catch(e){}
        return {error:true,code:"backup-id-collision"};
      }
      snapshotStore.put({hash:payloadHash,payload:backup.payload},payloadHash);
      if(!existing){const {payload,...saved}=backup;backupStore.put({...saved,payloadHash},saved.id);}
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

    async function deleteBackup(id,{payload,allowedKinds=[]}={}){
      ensureOpen();
      const payloadHash=typeof payload==="string"?await sha(payload):null;
      const tx=db.transaction(["meta","snapshots","backups"],"readwrite"),done=transactionDone(tx),store=tx.objectStore("backups"),snapshotStore=tx.objectStore("snapshots");
      const [row,head,rows]=await Promise.all([
        requestResult(store.get(id)),requestResult(tx.objectStore("meta").get("head")),requestResult(store.getAll()),
      ]);
      if(!row||(payloadHash&&row.payloadHash!==payloadHash)||(allowedKinds.length&&!allowedKinds.includes(row.kind))){
        tx.abort();try{await done;}catch(e){}return false;
      }
      store.delete(id);
      if(head?.hash!==row.payloadHash&&!rows.some(other=>other.id!==id&&other.payloadHash===row.payloadHash))
        snapshotStore.delete(row.payloadHash);
      await done;return true;
    }

    const pendingKey=account=>"pending:"+account;
    async function getPendingUpload(account){
      ensureOpen();if(typeof account!=="string"||!account)return null;
      const tx=db.transaction("meta","readonly"),done=transactionDone(tx),value=await requestResult(tx.objectStore("meta").get(pendingKey(account)));
      await done;return value||null;
    }
    async function setPendingUpload(account,record){
      ensureOpen();
      if(typeof account!=="string"||!account||!record||typeof record.generationId!=="string"||
         !/^[0-9a-f]{64}$/.test(record.payloadHash)||!Number.isSafeInteger(record.baseRev)||record.baseRev<0)
        return {error:true,code:"invalid-pending-upload"};
      const value={generationId:record.generationId,payloadHash:record.payloadHash,baseRev:record.baseRev,
        updatedAt:Number.isFinite(record.updatedAt)?record.updatedAt:0,account};
      const tx=db.transaction("meta","readwrite"),done=transactionDone(tx);tx.objectStore("meta").put(value,pendingKey(account));await done;return {ok:true};
    }
    async function clearPendingUpload(account,generationId){
      ensureOpen();if(typeof account!=="string"||!account)return false;
      const tx=db.transaction("meta","readwrite"),done=transactionDone(tx),store=tx.objectStore("meta"),current=await requestResult(store.get(pendingKey(account)));
      if(!current||current.generationId!==generationId){tx.abort();try{await done;}catch(e){}return false;}
      store.delete(pendingKey(account));await done;return true;
    }
    async function setLegacyFingerprint(expectedHash,fingerprint){
      ensureOpen();if(typeof fingerprint!=="string"||!fingerprint)return false;
      const tx=db.transaction("meta","readwrite"),done=transactionDone(tx),store=tx.objectStore("meta"),current=await requestResult(store.get("head"));
      if(!current||current.hash!==expectedHash){tx.abort();try{await done;}catch(e){}return false;}
      store.put({...current,sourceFingerprint:fingerprint},"head");await done;return true;
    }

    async function close(){if(db){db.close();db=null;}}
    const api={open,close,readHead,listBackups,listOpaqueArchives,migrateLegacy,commitHead,putBackup,
      updateBackupKind,deleteBackup,getPendingUpload,setPendingUpload,clearPendingUpload,setLegacyFingerprint};
    return api;
  }

  root.ChainStorageV2={SCHEMA_VERSION,DEFAULT_TARGET_BYTES,hashPayload,encodeSnapshot,decodeSnapshot,createDeviceStore};
})(globalThis);
