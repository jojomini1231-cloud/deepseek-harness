---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-23-merge-rewind-source

English | [中文](2026-11-23-merge-rewind-source.zh.md)

## Summary

Restores the conversation-rewind source kind that dev's retract-and-edit feature records on its empty developer marker, on top of master's cua notice kinds.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-23-merge-rewind-source
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-11-19-cua-input-notices"
    after: "2007571b478834b3cda56fa0f5e721cbf7b3fe43d9f9674929d54098cf527772"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-11-19-cua-input-notices"
    after: "a72e494296104a5a5ebe9254bfb992c09cb2806dff118ad19cc744c25e6cd260"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-11-19-cua-input-notices"
    after: "2324fac0ecbb031374ff20ceb9690d86304e16e274e0ad04724523ac67548a60"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-11-19-cua-input-notices"
    after: "5b5bede981a4c3aa99ba8d7bd98a5c82de06378a841d4272e15a9d46840eac5f"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

New writers only emit the kind on a developer/message whose content is empty, so no derived model-visible message depends on interpreting it, and on inbox copies of that same marker. Older readers treat an unknown merge-extensible source kind as opaque producer metadata and keep the record, so existing records keep their meaning and no reader rewrite is required. The kind carries the retracted target sequence, which consumers use for display only. New readers preserve every master cua kind and every earlier record unchanged; both sides' additions meet in one union.

<a id="verification"></a>
## Verification

pnpm run verify-persistence-catalog: 8 artifacts up to date; pnpm run verify-persistence-formats: v0 through v4 verified (5 complete references).

<a id="dev-note"></a>
## Dev Note

None.
