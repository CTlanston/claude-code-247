# Command inbox

Append commands to the "## Pending" section. The supervisor processes them
on its next cycle and moves them to `commands/processed.md`. **Lines inside
the fenced block below are documentation, NOT live commands** — the parser
ignores anything between ``` fences.

Supported commands:

```
/status
/report
/pause
/resume
/new-task P0 <title> :: <details>
/new-task P1 <title> :: <details>
/new-task P2 <title> :: <details>
/set-mode cheap
/set-mode balanced
/set-mode premium
/allow-live true
/allow-live false
/allow-autostart true
/allow-autostart false
```

Each command must be on its own line and start with `/`. Anything else is
ignored.

## Pending

(empty)
