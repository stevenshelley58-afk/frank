"""Lease-gated launcher for Codex tasks on the VPS shared estate.

A writable Codex task can only start in the private host path resolved from
the opaque ``workspace_id`` after its exclusive lease is granted. The random
generation is passed only to the heartbeat helper. While the task is alive
the lease is renewed; if renewal becomes impossible the task is terminated
and the launcher fails closed — it never continues unlocked. After a
verified exit the lease is released. Direct writable Codex project entry
that bypasses this launcher is denied by the frozen supported-host policy.
"""
from __future__ import annotations

import subprocess
import threading
import time
from typing import Callable, Sequence

from .lease import LeaseError, WorkspaceLease
from .schemas import LeaseOwner


class LaunchRefused(RuntimeError):
    """The leased launch cannot proceed; fail closed."""


def run_leased_task(
    lease: WorkspaceLease,
    workspace_id: str,
    owner: LeaseOwner,
    argv: Sequence[str],
    *,
    workdir: str,
    heartbeat_interval: float,
    env: dict[str, str] | None = None,
    terminate: Callable[[subprocess.Popen], None] | None = None,
    owner_verifier: Callable[[LeaseOwner], bool] | None = None,
) -> dict:
    """Run one writable task entirely inside an acquired lease generation.

    Acquisition is immediate: a busy workspace refuses without entering the
    checkout. Each heartbeat cycle also consults ``owner_verifier`` when
    provided; a verified-dead owner or any renewal error terminates the task
    and fails closed — the checkout is never held without a live lease.
    """
    try:
        grant = lease.acquire(workspace_id, owner, max_wait_seconds=0.0)
    except LeaseError as error:
        raise LaunchRefused(f"lease unavailable; task not started: {error}") from error
    generation = grant.generation
    stopped = threading.Event()
    renewal_failure: list[str] = []

    def _heartbeat() -> None:
        while not stopped.wait(heartbeat_interval):
            try:
                lease.heartbeat(workspace_id, generation)
                if owner_verifier is not None and not owner_verifier(owner):
                    renewal_failure.append("authoritative verifier reports the owner is gone")
                    return
            except LeaseError as error:
                renewal_failure.append(str(error))
                return  # launcher terminates the task; never continue unlocked

    heartbeat_thread = threading.Thread(target=_heartbeat, daemon=True)
    heartbeat_thread.start()
    process: subprocess.Popen | None = None
    try:
        process = subprocess.Popen(
            list(argv), cwd=workdir, env=env,
            # The launcher deliberately returns only the exit status. A pipe
            # with no reader both leaks its descriptor and can block a noisy
            # task once its buffer fills.
            stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT,
        )
        while process.poll() is None:
            if renewal_failure:
                # Renewal failed: stop the task and fail closed.
                if terminate is not None:
                    terminate(process)
                else:
                    process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
                raise LaunchRefused("lease renewal failed; task terminated before completion")
            time.sleep(0.05)
        returncode = process.returncode
    finally:
        stopped.set()
        heartbeat_thread.join(timeout=5)
        try:
            lease.release(workspace_id, generation)
        except LeaseError:
            # Release after verified exit; stale release must not mask results.
            pass
    if renewal_failure:
        raise LaunchRefused("lease renewal failed during task execution")
    return {"ok": returncode == 0, "returncode": returncode, "workspace_id": workspace_id, "generation": generation}
