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
    previous: "2026-10-27-retry-control-input"
    after: "929f58aa2d47a73d6c4717a1e32a3692e98c780eff38c2bb2ddc2e256c7cca97"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-27-retry-control-input"
    after: "90eea3e13bf48c0feed7130230eb361d642c5117030b82ef37eeb7151da9d561"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-27-retry-control-input"
    after: "8d6521e118b733c6a12600b83130d077b784663aa6c33e08c3bcc0c43fcf298a"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-27-retry-control-input"
    after: "52f70013ff05a571780b4c1b87d296bdc350e7d7b96a85dc1e933be0f1104da3"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

New writers only emit the kind on a `developer/message` whose content is empty, so no derived model-visible message depends on interpreting it, and on inbox copies of that same marker. Older readers treat an unknown merge-extensible source kind as opaque producer metadata and keep the record, so existing records keep their meaning and no reader rewrite is required. The kind carries the retracted target sequence; consumers use it to hide the retracted rows, and a target at or before an eligible failed `turn/end` withdraws empty-prompt continuation eligibility.

<a id="verification"></a>
## Verification

pnpm exec vitest run --project thread-safe packages/api/session-controller/tests/commands-rewind.host.spec.ts: 9 tests passed; pnpm exec vitest run --project thread-safe packages/api/session-controller/tests: 1109 tests passed.

<a id="dev-note"></a>
## Dev Note

None.
