# Twin Commenter architecture

## Goal
A second computer can receive explicitly shared session information and send text comments back to the host.

## Host -> Commenter
- speaker.partial
- speaker.final
- assistant.delta
- assistant.complete
- session.state
- host.status

## Commenter -> Host
- authenticate
- comment.send
- ping
- disconnect

There are intentionally no protocol messages for mouse, keyboard, clipboard, shell, file writes, or application control.

## Source separation
```text
microphone/system audio -> Speaker 1 / Speaker 2
remote connection       -> Commenter
LLM                     -> Assistant
```

Commenter text should not be inserted into the speech-to-text pipeline.
