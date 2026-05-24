# claude-code-247 runner image.
#
# What goes here: every dependency a per-task worker container needs to
# (a) work the repo (git, gh CLI), (b) drive the local Claude Code worker
# path (claude CLI via npm), and (c) execute the per-repo test / lint /
# build commands (Python, Node, common shells). Per-repo tooling beyond
# this gets installed on first task invocation inside the workspace.
#
# Auth strategy: the orchestrator bind-mounts ~/.claude (read-only) into
# the container at /home/runner/.claude so the locally-authenticated
# Claude Code session carries through. The container never writes back.

FROM python:3.13-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    NODE_VERSION=20.x

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl git gnupg jq sqlite3 build-essential \
        openssh-client procps less \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        | gpg --dearmor -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        > /etc/apt/sources.list.d/github-cli.list \
    && curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION} | bash - \
    && apt-get update && apt-get install -y --no-install-recommends \
        gh nodejs \
    && rm -rf /var/lib/apt/lists/*

# Claude Code CLI (npm).
RUN npm install -g @anthropic-ai/claude-code

# Non-root user; bind-mounts at runtime use this user's home for ~/.claude
# pass-through.
RUN useradd -m -u 1001 -s /bin/bash runner

# Bring in only the runner driver + memory schema (the orchestrator
# package isn't needed inside the container).
WORKDIR /opt/claude247
COPY runner/ ./runner/
COPY memory/schema.sql ./memory/schema.sql
COPY runner/entrypoint.sh /entrypoint.sh
RUN chmod 755 /entrypoint.sh

USER runner
WORKDIR /workspace
ENTRYPOINT ["/entrypoint.sh"]
