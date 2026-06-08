# Agent Runtime Modes

Cherry Studio Pi supports two compatible agent runtimes:

- **Standard mode** uses the Pi agent runtime (`type: "pi"`). This is the
  default for newly created agents. It is the fast, token-efficient path and
  should call Cherry Studio Pi internals through IPC/direct services instead of
  depending on the local API server.
- **Enhanced mode** uses the Claude Agent SDK runtime (`type: "claude-code"`).
  It remains supported for agents that need the more complex Claude Code tool
  behavior, but it must not replace Pi as the default.

Merge rules when syncing upstream Cherry Studio changes:

- Keep `src/main/ai/runtime/pi/register.ts` imported by
  `src/main/ai/runtime/index.ts`.
- Keep create-agent defaults on `type: "pi"` unless the user explicitly picks
  enhanced mode.
- Do not gate in-app agent session creation on `apiServer.enabled`.
- Do not inject `PERRY_STUDIO_API_*` or `CHERRY_STUDIO_API_*` into the Pi tool
  environment. Pi tools should prefer IPC/direct app capability calls.
- Keep both `pi` and `claude-code` in `AgentTypeSchema` for compatibility.
