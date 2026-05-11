"""SandboxRunner — thin adapter onto the existing Docker spawn surface.

The inner engine's `orchestrator/runner.py:run_role()` already knows how to
spawn ephemeral runner containers with the right bind-mounts, uid mapping,
and OAuth/API-key routing. The AutoDev v3 supervisor never spawns
containers directly — it goes through the inner engine — so this adapter is
intentionally light. It exists to give the report layer a stable place to
ask "is Docker working" without reaching into orchestrator internals.
"""
from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from typing import Optional


@dataclass
class SandboxHealth:
    docker_present: bool
    daemon_up: bool
    runner_image_present: bool
    runner_image: str
    details: str


class SandboxRunner:
    DEFAULT_IMAGE = "claude-code-247/runner:latest"

    def __init__(self, *, runner_image: str = DEFAULT_IMAGE):
        self.image = runner_image

    def health(self) -> SandboxHealth:
        docker_bin = shutil.which("docker")
        if not docker_bin:
            return SandboxHealth(False, False, False, self.image, "docker CLI not on PATH")
        try:
            r = subprocess.run(
                ["docker", "info", "--format", "{{.ServerVersion}}"],
                capture_output=True, text=True, timeout=5,
            )
        except (OSError, subprocess.SubprocessError) as e:
            return SandboxHealth(True, False, False, self.image, f"daemon probe error: {e}")
        if r.returncode != 0:
            return SandboxHealth(True, False, False, self.image, "docker daemon not responsive")
        srv = (r.stdout or "").strip()
        try:
            ri = subprocess.run(
                ["docker", "image", "inspect", self.image],
                capture_output=True, text=True, timeout=5,
            )
        except (OSError, subprocess.SubprocessError) as e:
            return SandboxHealth(True, True, False, self.image, f"image probe error: {e}")
        image_present = ri.returncode == 0
        return SandboxHealth(
            True, True, image_present, self.image,
            f"daemon={srv}; image_present={image_present}",
        )

    def runner_image_size_bytes(self) -> Optional[int]:
        try:
            r = subprocess.run(
                ["docker", "image", "inspect", self.image, "--format", "{{.Size}}"],
                capture_output=True, text=True, timeout=5,
            )
        except (OSError, subprocess.SubprocessError):
            return None
        if r.returncode != 0:
            return None
        try:
            return int(r.stdout.strip())
        except ValueError:
            return None
