/* Immutable chunk generations keep Firestore's one-document limit out of the
   board contract. A tiny revisioned manifest is the only visibility point;
   staged or interrupted uploads stay unreachable until verified and sealed. */
(function(root){
  "use strict";

  const SCHEMA_VERSION=2;
  const randomId=crypto=>{
    if(typeof crypto.randomUUID==="function") return crypto.randomUUID();
    const data=new Uint8Array(16);crypto.getRandomValues(data);
    return Array.from(data,value=>value.toString(16).padStart(2,"0")).join("");
  };
  const sameGeneration=(header,encoded,baseRev)=>header&&header.schemaVersion===SCHEMA_VERSION&&
    header.chunkCount===encoded.chunkCount&&header.byteLength===encoded.byteLength&&header.hash===encoded.hash&&
    header.encoding===encoded.encoding&&header.baseRev===baseRev&&["staging","sealed","published"].includes(header.state);
  const sameChunk=(left,right)=>left&&left.index===right.index&&left.byteLength===right.byteLength&&left.hash===right.hash&&left.text===right.text;
  const safeFailureCode=error=>{
    const code=typeof error?.code==="string"?error.code.replace(/^firestore\//,""):"";
    return /^[a-z0-9-]{1,64}$/.test(code)?code:"upload-interrupted";
  };

  function createCloudStore({adapter,crypto=root.crypto,targetBytes=256*1024,batchSize=200}={}){
    if(!adapter) throw new Error("Cloud adapter is required");
    if(!crypto?.subtle) throw new Error("Web Crypto is required");
    if(!root.ChainStorageV2) throw new Error("Snapshot codec is required");
    if(!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>400) throw new RangeError("Cloud batch size is invalid");
    const current=callback=>typeof callback!=="function"||callback();
    const needsDecisionCapability=payload=>{
      try{
        const board=JSON.parse(payload);
        return board&&typeof board==="object"&&["decisionEvents","decisionEventsRecovery","decisionBaseline","decisionBaselineRecovery"].some(key=>Object.hasOwn(board,key));
      }catch{return false;}
    };

    // One process-local conclusion per account: "this server manifest revision
    // names a generation already proved unreadable". A published generation is
    // immutable, so downloading the same unreadable bytes again cannot change
    // the answer. The root is still read from the server on every pull: only
    // a fresh manifest can say whether the conclusion still applies, and the
    // conclusion only ever yields an error, never a payload, so it cannot let
    // a stale copy decide the board.
    const unreadable=new Map();
    const knownUnreadable=(uid,manifest)=>{
      const known=unreadable.get(uid);
      return !!known&&known.rev===manifest.rev&&known.generationId===manifest.activeGeneration;
    };

    // Only a caller that already holds a completed refusal for this source
    // opts in with reuseUnreadable. Every other pull (explicit Retry, a fresh
    // sign-in, a direct read) proves the answer again, so a generation whose
    // chunks were restored in place is still seen.
    // A caller may also pass a conclusion it kept from an earlier launch for
    // this account; it is honoured only for the same fresh manifest.
    // #2354: a caller that holds the exact board of its acknowledged copy
    // passes that copy's revision and ID as unchangedSince. When the root just
    // read from the server still names both, a published copy is immutable, so
    // downloading it again cannot change the answer: the pull reads nothing
    // else and says unchanged. Any other root falls through to the full read.
    // (#2354 review: a copy is immutable only because firestore.rules make it
    // so: chunks are written only while it is staging and never updated, and
    // removed only once it is deleting and no root names it. A rules change
    // that lets a named copy change must revisit this shortcut.)
    // The caller proves it holds the board; this store never answers from a
    // cached root, and recovery, adoption and repair reads never pass it.
    async function pull(uid,{stillCurrent,reuseUnreadable=false,knownUnreadable:remembered=null,unchangedSince=null}={}){
      if(!uid) return {error:true,code:"missing-account"};
      let manifest=await adapter.readRoot(uid);
      if(!current(stillCurrent)) return {cancelled:true};
      if(!manifest) return {empty:true};
      if(manifest.schemaVersion!==SCHEMA_VERSION){
        return typeof manifest.payload==="string" ? manifest : {error:true,code:"invalid-manifest"};
      }
      if(reuseUnreadable!==true&&Number.isSafeInteger(unchangedSince?.rev)&&unchangedSince.rev>=1&&
        typeof unchangedSince.generationId==="string"&&unchangedSince.generationId&&
        manifest.rev===unchangedSince.rev&&manifest.activeGeneration===unchangedSince.generationId)
        return {unchanged:true,rev:manifest.rev,generationId:manifest.activeGeneration,updatedAt:manifest.updatedAt,
          serverUpdatedAt:manifest.serverUpdatedAt,schemaVersion:SCHEMA_VERSION,includedSeq:includedSeqOf(manifest)};
      for(let attempt=0;attempt<3;attempt++){
        const generationId=manifest.activeGeneration;
        if(typeof generationId!=="string"||!Number.isSafeInteger(manifest.rev)||manifest.rev<1)
          return {error:true,code:"invalid-manifest"};
        if(reuseUnreadable===true&&(knownUnreadable(uid,manifest)||
          remembered?.rev===manifest.rev&&remembered.generationId===generationId))
          return {error:true,code:"corrupt-generation",generationId,rev:manifest.rev,knownUnreadable:true};
        try{
          // Both immutable reads use the same manifest generation. Download
          // together, then verify the complete snapshot and recheck the root;
          // overlapping network waits must never bypass those safety gates.
          const [header,chunks]=await Promise.all([
            adapter.readGeneration(uid,generationId),adapter.readChunks(uid,generationId)
          ]);
          if(!current(stillCurrent)) return {cancelled:true};
          if(!header||!["sealed","published"].includes(header.state)) throw new Error("active generation is unavailable");
          const payload=await root.ChainStorageV2.decodeSnapshot(header,chunks);
          if(!current(stillCurrent)) return {cancelled:true};
          const latest=await adapter.readRoot(uid);
          if(!current(stillCurrent)) return {cancelled:true};
          if(latest?.schemaVersion===SCHEMA_VERSION&&
             (latest.rev!==manifest.rev||latest.activeGeneration!==generationId)){
            manifest=latest;continue;
          }
          return {payload,rev:manifest.rev,updatedAt:manifest.updatedAt,
            serverUpdatedAt:manifest.serverUpdatedAt,schemaVersion:SCHEMA_VERSION,generationId,hash:header.hash,includedSeq:includedSeqOf(manifest)};
        }catch(error){
          if(!current(stillCurrent)) return {cancelled:true};
          // A failed network/auth read says nothing about snapshot integrity.
          // Preserve its safe code so startup can retry transient failures and
          // keep real permission errors blocked, rather than calling both corrupt.
          const code=safeFailureCode(error);
          if(code!=="upload-interrupted") return {error:true,code,generationId};
          const latest=await adapter.readRoot(uid);
          if(!current(stillCurrent)) return {cancelled:true};
          if(latest?.schemaVersion===SCHEMA_VERSION&&
             (latest.rev!==manifest.rev||latest.activeGeneration!==generationId)){
            manifest=latest;continue;
          }
          unreadable.set(uid,{rev:manifest.rev,generationId});
          return {error:true,code:"corrupt-generation",generationId,rev:manifest.rev};
        }
      }
      return {error:true,code:"manifest-changed"};
    }

    // #2417: includedSeq, when the caller gives one, is the sequence number up
    // to which this board includes the account's change records; the root
    // names it, so the records it covers can go (removeIncludedChangeRecords).
    async function push(uid,payload,updatedAt,baseRev,{generationId=randomId(crypto),stillCurrent,includedSeq}={}){
      if(!uid||!Number.isSafeInteger(baseRev)||baseRev<0) return {error:true,code:"invalid-revision"};
      let encoded;
      try{encoded=await root.ChainStorageV2.encodeSnapshot(payload,{targetBytes});}
      catch(error){return {error:true,code:"invalid-payload",generationId};}
      const header={schemaVersion:SCHEMA_VERSION,state:"staging",encoding:encoded.encoding,
        chunkCount:encoded.chunkCount,byteLength:encoded.byteLength,hash:encoded.hash,baseRev,createdAt:Date.now()};
      let publishing=false;
      try{
        const existing=await adapter.beginGeneration(uid,generationId,header);
        if(!current(stillCurrent)) return {cancelled:true,generationId};
        if(!sameGeneration(existing,encoded,baseRev)) return {error:true,code:"generation-mismatch",generationId};
        // Only the acknowledged create transaction can prove this generation
        // began empty. Resumed/unknown generations still read every old chunk;
        // every path retains the full post-write verification before sealing.
        const present=existing.freshlyCreated===true ? [] : await adapter.readChunks(uid,generationId);
        if(!current(stillCurrent)) return {cancelled:true,generationId};
        const byIndex=new Map();
        for(const chunk of present){
          if(byIndex.has(chunk.index)||!sameChunk(chunk,encoded.chunks[chunk.index]))
            return {error:true,code:"chunk-mismatch",generationId};
          byIndex.set(chunk.index,chunk);
        }
        const missing=encoded.chunks.filter(chunk=>!byIndex.has(chunk.index));
        for(let offset=0;offset<missing.length;offset+=batchSize){
          if(!current(stillCurrent)) return {cancelled:true,generationId};
          await adapter.writeChunks(uid,generationId,missing.slice(offset,offset+batchSize));
        }
        // #2459: a full copy reads each chunk three times: this listing, the
        // seal transaction and the publish transaction (sealGeneration and
        // publishGeneration's verifiedGeneration). Each read proves something
        // the others do not, so all three stay:
        // - this listing is the only read of the whole chunk collection, as a
        //   pull reads it, so only it finds a chunk beyond the copy's count;
        //   a transaction reads documents by path and cannot list.
        // - the seal reads the chunks inside the transaction that seals them,
        //   so a chunk lost or changed after this listing fails the seal.
        // - the publication reads them under the root's revision guard, inside
        //   the transaction that names the copy; the seal has no revision
        //   guard, and only firestore.rules keep a sealed copy's chunks from
        //   changing in between. The RISK CLOUD TRANSACTION tests change and
        //   delete chunks after the seal and require the publication to fail.
        // Dropping one needs a read that proves what it checks: the same chunk
        // list and hashes under the same revision guard.
        const verifiedChunks=await adapter.readChunks(uid,generationId);
        if(!current(stillCurrent)) return {cancelled:true,generationId};
        if(await root.ChainStorageV2.decodeSnapshot(encoded,verifiedChunks)!==payload)
          return {error:true,code:"verification-failed",generationId};
        const sealed=["sealed","published"].includes(existing.state) ? existing : await adapter.sealGeneration(uid,generationId,header);
        if(!sealed||!["sealed","published"].includes(sealed.state)) return {error:true,code:"seal-failed",generationId};
        if(!current(stillCurrent)) return {cancelled:true,generationId};
        publishing=true;
        const result=await adapter.publishGeneration(uid,generationId,{baseRev,updatedAt,hash:encoded.hash,expectedHeader:header,stillCurrent,decisionCapability:needsDecisionCapability(payload)?1:undefined,
          ...(Number.isSafeInteger(includedSeq)&&includedSeq>=0?{includedSeq}:{})});
        if(!current(stillCurrent)) return {cancelled:true,generationId};
        // #2354: the copy's ID and hash let the caller recognise this exact
        // published copy on a later pull without downloading it.
        return result?.ok?{...result,generationId,hash:encoded.hash}:{...result,generationId};
      }catch(error){
        const code=safeFailureCode(error);
        // #2426: Firestore checks a publication against the rules as the
        // root stands at its commit, and the rules read the root's revision.
        // When another device published over the same revision between this
        // publication's read and its commit, the commit is refused with
        // permission-denied, which the SDK never retries, rather than meeting
        // the revision guard inside the transaction. Only a fresh read showing
        // the root past this push's revision makes it that conflict, so the
        // caller pulls, merges and publishes again under the guard. Any other
        // refusal, or a root this account cannot read, stays the refusal.
        if(publishing&&code==="permission-denied"){
          const moved=await rootPastRevision(uid,baseRev);
          if(!current(stillCurrent)) return {cancelled:true,generationId};
          if(moved) return {conflict:true,rev:moved.rev,generationId};
        }
        return {error:true,code,generationId};
      }
    }

    async function rootPastRevision(uid,baseRev){
      try{
        const latest=await adapter.readRoot(uid);
        return latest?.schemaVersion===SCHEMA_VERSION&&Number.isSafeInteger(latest.rev)&&latest.rev>baseRev?latest:null;
      }catch(error){return null;}
    }

    async function collectGarbage(uid,{pendingGenerationIds=[]}={}){
      const manifest=await adapter.readRoot(uid),protectedIds=new Set(pendingGenerationIds);
      if(manifest?.schemaVersion===SCHEMA_VERSION){
        if(manifest.activeGeneration) protectedIds.add(manifest.activeGeneration);
        if(manifest.previousGeneration) protectedIds.add(manifest.previousGeneration);
      }
      const removed=[];
      for(const generation of await adapter.listGenerations(uid)){
        if(protectedIds.has(generation.id)) continue;
        const createdAt=typeof generation.createdAt==="number"?generation.createdAt:generation.createdAt?.toMillis?.();
        // A different device can be between its final chunk and manifest CAS.
        // The root cannot name a staging generation yet, so root references
        // alone are not a deletion lock. Give every unpublished upload a full
        // week to resume; already-deleting generations may finish cleanup.
        if(!["published","deleting"].includes(generation.state)&&(!Number.isFinite(createdAt)||Date.now()-createdAt<7*86400000))continue;
        if(!await adapter.markDeleting(uid,generation.id,[...protectedIds])) continue;
        await adapter.deleteChunks(uid,generation.id);
        await adapter.deleteGeneration(uid,generation.id);removed.push(generation.id);
      }
      return {ok:true,removed};
    }

    // #2417: change records. A record is {id, parts}: parts is the text of
    // the board parts one change touched. appendChangeRecord has the adapter
    // give it the account's next sequence number in one transaction with the
    // account's counter; asking again with the same id returns the number it
    // already has, so an uncertain send can be repeated. changeRecordsAfter
    // lists the well-formed records above a full copy's includedSeq by
    // sequence. removeIncludedChangeRecords has the adapter delete the records
    // at or below the includedSeq the active root names; firestore.rules
    // refuse any other. Without the adapter's support records are unsupported.
    async function appendChangeRecord(uid,{id,parts}={},{stillCurrent}={}){
      if(!uid)return {error:true,code:"missing-account"};
      if(typeof id!=="string"||!RECORD_ID.test(id)||typeof parts!=="string"||!parts||parts.length>MAX_RECORD_CHARS)return {error:true,code:"invalid-record"};
      if(typeof adapter.appendChangeRecord!=="function")return {unsupported:true};
      const result=await adapter.appendChangeRecord(uid,{id,parts},{stillCurrent});
      if(!current(stillCurrent))return {cancelled:true};
      if(result?.ok&&(!Number.isSafeInteger(result.seq)||result.seq<1||!Number.isSafeInteger(result.rev)||result.rev<0))
        return {error:true,code:"invalid-record-reply"};
      return result;
    }
    async function removeIncludedChangeRecords(uid,includedSeq,records){
      if(!uid||!Number.isSafeInteger(includedSeq)||includedSeq<1||typeof adapter.deleteChangeRecords!=="function")return {ok:true,removed:[]};
      const ids=changeRecordsAfter(records).filter(row=>row.seq<=includedSeq).map(row=>row.id);
      if(ids.length)await adapter.deleteChangeRecords(uid,ids);
      return {ok:true,removed:ids};
    }

    return {pull,push,collectGarbage,appendChangeRecord,removeIncludedChangeRecords};
  }

  // #2417: the root's includedSeq, or 0 when it names none: an older app's
  // root, which lists no records.
  function includedSeqOf(manifest){
    return Number.isSafeInteger(manifest?.includedSeq)&&manifest.includedSeq>=0?manifest.includedSeq:0;
  }
  const RECORD_ID=/^[A-Za-z0-9_-]{1,128}$/,MAX_RECORD_CHARS=256*1024;
  function changeRecordsAfter(records,includedSeq=0){
    const floor=Number.isSafeInteger(includedSeq)&&includedSeq>=0?includedSeq:0,seen=new Set(),rows=[];
    for(const row of Array.isArray(records)?records:[]){
      if(!row||typeof row.id!=="string"||!RECORD_ID.test(row.id)||!Number.isSafeInteger(row.seq)||row.seq<=floor||
        typeof row.parts!=="string"||row.parts.length>MAX_RECORD_CHARS||seen.has(row.seq))continue;
      seen.add(row.seq);rows.push({id:row.id,seq:row.seq,parts:row.parts});
    }
    return rows.sort((a,b)=>a.seq-b.seq);
  }

  root.ChainCloudV2={SCHEMA_VERSION,createCloudStore,includedSeqOf,changeRecordsAfter,MAX_RECORD_CHARS};
})(globalThis);
