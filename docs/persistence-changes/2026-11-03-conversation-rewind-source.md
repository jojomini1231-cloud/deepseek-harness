---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-03-conversation-rewind-source

English | [中文](2026-11-03-conversation-rewind-source.zh.md)

## Summary

Adds the `conversation-rewind` message source that a retraction or conversation edit records on its empty developer marker.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-03-conversation-rewind-source
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "82b1a321bd2bffbd80a6c7293d9f0255f00c37d13d4d73ee5acfff2dc7887b90"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "ca95c28d51c7c012048f9c196589447efb210e922f5a2488862a17d184c3bbcf"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "e31d8ead75e13e76b41165526f3e26dae55834eca94699f5f0977b1b83341b4a"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "36d181a3b3ba581dbea24d460168a61b3ec1fb2df76adf92b2c230acbbf436ac"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

New writers only emit the kind on a `developer/message` whose content is empty, so no derived model-visible message depends on interpreting it, and on inbox copies of that same marker. Older readers treat an unknown merge-extensible source kind as opaque producer metadata and keep the record, so existing records keep their meaning and no reader rewrite is required. The kind carries the retracted target sequence, which consumers use for display only.

<a id="verification"></a>
## Verification

pnpm exec vitest run --project thread-safe packages/api/session-controller/tests/commands-rewind.host.spec.ts: 9 tests passed; pnpm exec vitest run --project thread-safe packages/api/session-controller/tests: 1109 tests passed.

<a id="dev-note"></a>
## Dev Note

None.
