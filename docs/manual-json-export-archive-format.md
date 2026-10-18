# Ticket 190 external archive format contract

Status: agreed for #190; current-board and archive remain separate products.

## Files

- `chain-scanner-current-board.json` is the ordinary compatible board JSON produced by the existing `currentBoardExportPayload()` boundary. It contains the accepted board currently open in the tab, including accepted unsaved edits, and is the only export intended for the ordinary guarded board-import consumer.
- `chain-scanner-recovery-archive.json` is a separate versioned preservation package. Its embedded `currentBoard` member is the same ordinary board object for reference; the archive itself is not an ordinary board-import file. A future explicit guarded operation may use only this supported `currentBoard` member. It must never restore raw app sources, authority markers, pending operations or opaque archives, and it must never replay or publish them.

## Version 1 envelope

```json
{
  "format": "chain-scanner.recovery-archive",
  "formatVersion": 1,
  "capturedAt": "ISO-8601 timestamp",
  "currentBoard": {},
  "manifest": {
    "status": "complete",
    "consistency": "single-readonly-idb-transaction-and-unchanged-live-sources",
    "sources": {
      "currentBoard": { "status": "included", "format": "existing-board-json" },
      "localStorage": {
        "fvp:chain-scanner:v1": { "status": "included" },
        "fvp:chain-scanner:protected:v1": { "status": "absent" },
        "fvp:chain-scanner:daily-backups:v1": { "status": "included" },
        "fvp:chain-scanner:device-store-v2": { "status": "included" }
      },
      "indexedDB": {
        "database": "chain-scanner-v2",
        "schemaVersion": 2,
        "stores": {
          "meta": { "status": "included", "rowCount": 0 },
          "snapshots": { "status": "included", "rowCount": 0 },
          "backups": { "status": "included", "rowCount": 0 },
          "opaque": { "status": "included", "rowCount": 0 }
        }
      }
    },
    "failures": []
  },
  "appSources": {
    "localStorage": [
      { "key": "fvp:chain-scanner:v1", "status": "present", "raw": "exact stored string" },
      { "key": "fvp:chain-scanner:protected:v1", "status": "absent" },
      { "key": "fvp:chain-scanner:daily-backups:v1", "status": "present", "raw": "exact stored string" },
      { "key": "fvp:chain-scanner:device-store-v2", "status": "present", "raw": "1" }
    ],
    "indexedDB": {
      "database": "chain-scanner-v2",
      "stores": {
        "meta": [{ "key": { "type": "string", "value": "head" }, "value": { "type": "object", "entries": [] } }],
        "snapshots": [],
        "backups": [],
        "opaque": []
      }
    }
  }
}
```

The example row counts and values are illustrative. Production output uses captured counts and values. Every allowlisted local key is listed whether present or absent. Present localStorage values are copied as exact strings without parsing or normalizing them. The device-authority marker is included as app-owned source evidence because it distinguishes authoritative IndexedDB from retained legacy bytes; archive capture or decoding never applies it to the active account or changes authority.

## Raw IndexedDB value encoding

`readRawExportSnapshot()` supplies exact key and value objects for all four stores in one `readonly` transaction on the already-open `deviceStore`; its key and value arrays must have equal lengths and remain paired in IndexedDB order. The archive keeps each raw value separate from the current-board member. Keys and values are serialized through the same collision-free typed-value envelope, rather than passing unknown values directly to `JSON.stringify`.

The v1 typed-value envelope uses a `type` tag at every node. Plain objects are represented as `{"type":"object","entries":[["original field name", <typed value>], ...]}` so an app object that happens to contain a tag-like property cannot be mistaken for an envelope. Arrays retain typed items, explicit hole tags, and a separate `properties` array of `[original name, typed value]` pairs for enumerable named own string properties. The isolated decoder uses own-property definitions so names such as `__proto__`, `constructor`, `01`, and `4294967295` remain data without changing the array prototype, native elements, length, or holes. The encoder/isolated test decoder must preserve null, booleans, strings, finite and special numbers (including NaN, both infinities and negative zero), `undefined`, BigInt, valid and invalid Date, plain objects, arrays, ArrayBuffer, DataView, typed arrays, Map and Set. Binary data is base64 encoded with the original view constructor/offset/length retained. Object field names, string values, and existing JSON strings stay unchanged.

Cycles, repeated references whose identity would be lost, or any other unsupported structured-clone type cause recovery-archive capture to stop with a retryable error naming the exact store/key and type. No row is silently omitted, no generic field-name filter is applied, and no incomplete archive is called complete. This bounded failure policy avoids inventing a lossy representation.

## Capture and failure semantics

- A complete archive is emitted only after successful hydration of the accepted live board and a successful read of every existing app-owned source.
- Capture never opens or creates IndexedDB. If the app has no already-open `chain-scanner-v2` handle, the archive action stops with an unavailable-source explanation.
- The four IndexedDB stores are read together by the existing raw snapshot port. The archive does not call SDK auth/session APIs, enumerate storage, or inspect unrelated browser keys.
- The fixed localStorage allowlist is the four keys shown above: board mirror, protected head, local backup index and device-authority marker. Values are read before and after the asynchronous IndexedDB snapshot; the accepted current-board payload is also rechecked. Any change, read exception, request error, transaction error or abort stops capture with a source-specific retry message and emits no misleading file.
- An absent allowlisted localStorage key is an explicit manifest status, not a read failure. A corrupt but readable string or unknown app-owned IDB row remains included exactly as raw data.
- A successful file has `manifest.status = "complete"`, exact per-source statuses/counts, and an empty `failures` list. Failed captures stop rather than writing an incomplete file without enough data to represent safely.
- Neither file creation nor view/copy fallback writes, deletes, resets, persists, reconciles, changes device/cloud authority, signs in, or enqueues any operation.
- The isolated round-trip proof for the ordinary board export uses the existing guarded import consumer. The isolated exact archive decode proof only verifies the typed envelope; it is not a production archive importer.
