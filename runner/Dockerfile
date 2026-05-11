FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates python3 python3-pip jq sqlite3 \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI (headless mode).
RUN npm install -g @anthropic-ai/claude-code

# Run as non-root: the CLI refuses --permission-mode bypassPermissions when uid=0.
# At runtime the orchestrator passes --user $HOST_UID:$HOST_GID so the bind-
# mounted workspace volume is writable. The image's built-in 'claude' user
# (uid 1001) is the fallback when no user override is set.
RUN useradd -m -u 1001 -s /bin/bash claude
WORKDIR /workspace

# Bake role prompts directly into the image instead of bind-mounting them at
# runtime. Bind-mount sources are resolved by the host docker daemon, and when
# the orchestrator runs *inside a container* (talking to the host docker via
# the socket) its in-container paths are not visible to the host. Baking is
# simpler and faster and removes one moving part.
COPY roles /system_prompts
COPY entrypoint.sh /entrypoint.sh
# Explicit mode: shell scripts must be world-READABLE (`r`), not just executable.
# Earlier we hit `Permission denied` because COPY preserved a host-side `711`.
RUN chmod 755 /entrypoint.sh && chmod -R a+r /system_prompts

USER claude
ENTRYPOINT ["/entrypoint.sh"]
