---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-05-timeline-priority-notice

English | [中文](2026-11-05-timeline-priority-notice.zh.md)

## Summary

Records a Timeline notice when the user adds or removes urgent priority.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-05-timeline-priority-notice
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-11-03-conversation-rewind-source"
    after: "8a6161569bae374e885cdc510e51daf98289ca0a25c46a904d7d0db0380481cf"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-11-03-conversation-rewind-source"
    after: "0ca428ae7b2dc2ac0e074a0aae83379bd0d6b6fa031b5c5e8b8c5d06a7122f83"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-11-03-conversation-rewind-source"
    after: "143bd9315db1ae102dead6400ca9ada98dc957e58097705bfcd8db8e8bc62de3"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-11-03-conversation-rewind-source"
    after: "3ef8a40b4aeae019580eaded7000d5e4a0fce0461c44001054b468020bfae287"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing messages keep their source and meaning. Timeline notices carry ordinary text and a source label. Readers without Timeline can keep the unknown source and read the text without applying a task update. Timeline stores task trees, reports, and discussions in the session log as ignorable `plugin:timeline/*` records. Readers without Timeline skip these records.

<a id="verification"></a>
## Verification

Timeline's priority tests check that only user edits to urgent priority enqueue a notice. The process recovery test checks that Timeline state survives an interrupted writer.

<a id="dev-note"></a>
## Dev Note

None.
