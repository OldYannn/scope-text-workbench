# SCOPE sidecar protocol

## Status and scope

This document defines the version `0.1` development contract between the desktop host and the Python engine. It covers diagnostic communication only. It does not define corpus, coding, or research-analysis behavior.

Transport is UTF-8 newline-delimited JSON (NDJSON): one complete JSON object per line. The host writes requests to the engine's standard input. The engine writes protocol messages to standard output and human-readable diagnostics to standard error.

## Compatibility

- Every request and response carries `protocol_version`.
- Version `0.1` requires an exact version match.
- Adding optional object fields is backward-compatible within `0.1`.
- Removing or changing field meanings requires a protocol version change.
- Unknown fields must be ignored unless accepting them would change research behavior.
- Unknown methods return a structured error.

## Request envelope

```json
{"protocol_version":"0.1","request_id":"req-1","method":"system.describe","params":{}}
```

Required fields:

| Field | Type | Meaning |
|---|---|---|
| `protocol_version` | string | Protocol contract used by the caller |
| `request_id` | non-empty string | Correlates all output for one request |
| `method` | non-empty string | Names the requested operation |
| `params` | object | Method-specific input |

## Output envelopes

Successful terminal response:

```json
{"protocol_version":"0.1","request_id":"req-1","type":"result","result":{"engine_version":"0.0.0","protocol_version":"0.1","capabilities":["system.describe"]}}
```

Failed terminal response:

```json
{"protocol_version":"0.1","request_id":"req-1","type":"error","error":{"code":"method_not_found","message":"Unknown method: example","details":{}}}
```

Progress event reserved for the diagnostic tracer bullet:

```json
{"protocol_version":"0.1","request_id":"req-2","type":"progress","progress":{"current":1,"total":10,"message":"Diagnostic step 1 of 10"}}
```

Each accepted request produces exactly one terminal `result` or `error`. It may produce zero or more `progress` messages first.

## Initial method

### `system.describe`

`params` must be an object and currently has no defined members. The result contains:

- `engine_version`: installed engine version;
- `protocol_version`: protocol implemented by the engine;
- `capabilities`: sorted method names supported by this engine build.

This method performs no project mutation and requires no network access.

## Error codes

| Code | Meaning |
|---|---|
| `invalid_json` | Input line is not valid JSON |
| `invalid_request` | Envelope shape or required fields are invalid |
| `incompatible_protocol` | Caller and engine protocol versions differ |
| `method_not_found` | Method is not supported |
| `internal_error` | Unexpected engine failure; details must not expose secrets |

When no valid `request_id` can be recovered, the engine uses `null`. Malformed input must not crash the long-running engine process.

## Lifecycle and cancellation

Milestone 0 will extend this contract with a non-research diagnostic operation and cancellation request. Cancellation is cooperative first; the Rust host may terminate and restart an unresponsive process after a documented timeout. A terminated request must never be represented as a successful research result.

## Security and reproducibility rules

- Protocol output must never contain API keys or tokens.
- Standard output is reserved for protocol messages.
- File access will use host-approved paths or project-relative references.
- Any future operation that can affect research results must record method version, parameters, input hashes, software versions, and random seed where applicable.
