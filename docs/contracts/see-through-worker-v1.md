# See-through worker protocol v1

Status: Phase 0 contract; no production worker is bundled with agent2live.

## Purpose

An external, NVIDIA-hosted worker turns a flat illustration into a layered PSD.
The desktop app uploads bytes, polls an asynchronous job, downloads a PSD, verifies
its checksum, and then runs PSD validation before PSD2Live binding.

## Security

- Bind to `127.0.0.1` by default. Remote access through an SSH tunnel or private
  mesh network; never expose the worker directly to the public internet.
- Every endpoint requires `Authorization: Bearer <token>`. Tokens are supplied by
  the operator, stored outside the repository, and never logged.
- Uploads and results expire after 24 hours. The worker must not retain source art
  for training or telemetry.

## Endpoints

| Method | Path                   | Purpose                                             |
| ------ | ---------------------- | --------------------------------------------------- |
| GET    | `/v1/health`           | Protocol version, worker version, GPU info          |
| POST   | `/v1/uploads`          | Raw image body; `content-type` + `x-content-sha256` |
| POST   | `/v1/jobs`             | Create or deduplicate a decomposition job           |
| GET    | `/v1/jobs/{id}`        | Job status, manifest, result metadata               |
| GET    | `/v1/jobs/{id}/result` | PSD bytes; `x-content-sha256` required              |

Request and response bodies are defined by `packages/contracts/src/see-through.ts`.
Unknown fields are rejected. Times are RFC 3339 UTC.

## Limits

- Image: PNG/JPEG/WebP, at most 20 MiB; 256–4096 px per side.
- PSD: at most 200 MiB; layers at most 256.
- One concurrent job per worker in Phase 0; queue the rest.
- Job timeout: 15 minutes. Result URLs/paths are worker-local and never persisted
  as external links.

## Errors

Errors use `application/problem+json` with `type`, `title`, `status`, `code`,
optional `detail` and `requestId`. Stable codes:

`SEE_THROUGH_UNAUTHORIZED`, `SEE_THROUGH_INVALID_INPUT`,
`SEE_THROUGH_PAYLOAD_TOO_LARGE`, `SEE_THROUGH_UNSUPPORTED_MEDIA`,
`SEE_THROUGH_CHECKSUM_MISMATCH`, `SEE_THROUGH_IDEMPOTENCY_CONFLICT`,
`SEE_THROUGH_JOB_NOT_FOUND`, `SEE_THROUGH_RESULT_NOT_READY`,
`SEE_THROUGH_RESULT_INVALID`, `SEE_THROUGH_TIMEOUT`, `SEE_THROUGH_INTERNAL`.

## Guarantees and non-goals

- The worker returns a PSD and a layer manifest. It does not write to the app
  database and does not call PSD2Live.
- Layer names are advisory. Semantic roles and bindable tags are reviewed by the
  app; unrecognized layers are never dropped.
- A worker result is not an `ArtVersion` or a publishable model.
- The stub worker in `spikes/see-through/` is contract-only and produces no
  semantic decomposition.
