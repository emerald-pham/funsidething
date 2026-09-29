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

    async function pull(uid,{stillCurrent}={}){
      if(!uid) return {error:true,code:"missing-account"};
      let manifest=await adapter.readRoot(uid);
      if(!current(stillCurrent)) return {cancelled:true};
      if(!manifest) return {empty:true};
      if(manifest.schemaVersion!==SCHEMA_VERSION){
        return typeof manifest.payload==="string" ? manifest : {error:true,code:"invalid-manifest"};
      }
      for(let attempt=0;attempt<3;attempt++){
        const generationId=manifest.activeGeneration;
        if(typeof generationId!=="string"||!Number.isSafeInteger(manifest.rev)||manifest.rev<1)
          return {error:true,code:"invalid-manifest"};
        try{
          const header=await adapter.readGeneration(uid,generationId);
          if(!current(stillCurrent)) return {cancelled:true};
          if(!header||!["sealed","published"].includes(header.state)) throw new Error("active generation is unavailable");
          const chunks=await adapter.readChunks(uid,generationId);
          if(!current(stillCurrent)) return {cancelled:true};
          const payload=await root.ChainStorageV2.decodeSnapshot(header,chunks);
          if(!current(stillCurrent)) return {cancelled:true};
          const latest=await adapter.readRoot(uid);
          if(!current(stillCurrent)) return {cancelled:true};
          if(latest?.schemaVersion===SCHEMA_VERSION&&
             (latest.rev!==manifest.rev||latest.activeGeneration!==generationId)){
            manifest=latest;continue;
          }
          return {payload,rev:manifest.rev,updatedAt:manifest.updatedAt,
            serverUpdatedAt:manifest.serverUpdatedAt,schemaVersion:SCHEMA_VERSION,generationId};
        }catch(error){
          const latest=await adapter.readRoot(uid);
          if(!current(stillCurrent)) return {cancelled:true};
          if(latest?.schemaVersion===SCHEMA_VERSION&&
             (latest.rev!==manifest.rev||latest.activeGeneration!==generationId)){
            manifest=latest;continue;
          }
          return {error:true,code:"corrupt-generation",generationId};
        }
      }
      return {error:true,code:"manifest-changed"};
    }

    async function push(uid,payload,updatedAt,baseRev,{generationId=randomId(crypto),stillCurrent}={}){
      if(!uid||!Number.isSafeInteger(baseRev)||baseRev<0) return {error:true,code:"invalid-revision"};
      let encoded;
      try{encoded=await root.ChainStorageV2.encodeSnapshot(payload,{targetBytes});}
      catch(error){return {error:true,code:"invalid-payload",generationId};}
      const header={schemaVersion:SCHEMA_VERSION,state:"staging",encoding:encoded.encoding,
        chunkCount:encoded.chunkCount,byteLength:encoded.byteLength,hash:encoded.hash,baseRev,createdAt:Date.now()};
      try{
        const existing=await adapter.beginGeneration(uid,generationId,header);
        if(!current(stillCurrent)) return {cancelled:true,generationId};
        if(!sameGeneration(existing,encoded,baseRev)) return {error:true,code:"generation-mismatch",generationId};
        const present=await adapter.readChunks(uid,generationId);
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
        const verifiedChunks=await adapter.readChunks(uid,generationId);
        if(!current(stillCurrent)) return {cancelled:true,generationId};
        if(await root.ChainStorageV2.decodeSnapshot(encoded,verifiedChunks)!==payload)
          return {error:true,code:"verification-failed",generationId};
        const sealed=["sealed","published"].includes(existing.state) ? existing : await adapter.sealGeneration(uid,generationId,header);
        if(!sealed||!["sealed","published"].includes(sealed.state)) return {error:true,code:"seal-failed",generationId};
        if(!current(stillCurrent)) return {cancelled:true,generationId};
        const result=await adapter.publishGeneration(uid,generationId,{baseRev,updatedAt,hash:encoded.hash,stillCurrent});
        if(!current(stillCurrent)) return {cancelled:true,generationId};
        return {...result,generationId};
      }catch(error){
        return {error:true,code:safeFailureCode(error),generationId};
      }
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

    return {pull,push,collectGarbage};
  }

  root.ChainCloudV2={SCHEMA_VERSION,createCloudStore};
})(globalThis);
