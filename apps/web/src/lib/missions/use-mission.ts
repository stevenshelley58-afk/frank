'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createMission, getMission, stopMission } from './client';
import {
  isMissionTerminal,
  type CreateMissionInput,
  type MissionSnapshot,
} from './types';

const POLL_INTERVAL_MS = 2_000;
const MISSION_STORAGE_KEY = 'frank.current-mission-id';
const PENDING_COMMAND_STORAGE_KEY = 'frank.pending-mission-command';
let cachedSnapshot: MissionSnapshot | null = null;

function newCommandId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `mission-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function commandIdFor(objective: string): string {
  if (typeof window === 'undefined') return newCommandId();
  try {
    const raw = window.sessionStorage.getItem(PENDING_COMMAND_STORAGE_KEY);
    const pending = raw === null ? null : (JSON.parse(raw) as unknown);
    if (
      typeof pending === 'object' &&
      pending !== null &&
      (pending as { objective?: unknown }).objective === objective &&
      typeof (pending as { commandId?: unknown }).commandId === 'string'
    ) {
      return (pending as { commandId: string }).commandId;
    }
  } catch {
    // Replace malformed browser state with a fresh command below.
  }
  const commandId = newCommandId();
  window.sessionStorage.setItem(
    PENDING_COMMAND_STORAGE_KEY,
    JSON.stringify({ objective, commandId }),
  );
  return commandId;
}

function clearPendingCommand(): void {
  if (typeof window !== 'undefined') {
    window.sessionStorage.removeItem(PENDING_COMMAND_STORAGE_KEY);
  }
}

function rememberSnapshot(snapshot: MissionSnapshot | null): void {
  cachedSnapshot = snapshot;
  if (typeof window === 'undefined') return;
  if (snapshot === null) {
    window.sessionStorage.removeItem(MISSION_STORAGE_KEY);
  } else {
    window.sessionStorage.setItem(MISSION_STORAGE_KEY, snapshot.mission.id);
  }
}

export interface MissionController {
  readonly snapshot: MissionSnapshot | null;
  readonly pendingObjective: string | null;
  readonly restoring: boolean;
  readonly submitting: boolean;
  readonly stopping: boolean;
  readonly active: boolean;
  readonly error: string | null;
  submit(input: CreateMissionInput): Promise<boolean>;
  stop(reason: string): Promise<boolean>;
}

export function useMission(): MissionController {
  const [snapshot, setSnapshot] = useState<MissionSnapshot | null>(() => cachedSnapshot);
  const [pendingObjective, setPendingObjective] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(() => cachedSnapshot === null);
  const [submitting, setSubmitting] = useState(false);
  const [stopRequestPending, setStopRequestPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const stoppingRef = useRef(false);

  const active = useMemo(
    () => snapshot !== null && !isMissionTerminal(snapshot.mission.state),
    [snapshot],
  );
  const stopping =
    stopRequestPending ||
    (active && snapshot?.mission.stopNewWork === true);

  useEffect(() => {
    // A null initial state can mean "not restored yet"; do not erase the
    // remembered durable id before the restore effect has read it.
    if (snapshot !== null) rememberSnapshot(snapshot);
  }, [snapshot]);

  useEffect(() => {
    if (snapshot !== null) {
      setRestoring(false);
      return;
    }
    const rememberedId = window.sessionStorage.getItem(MISSION_STORAGE_KEY);
    if (!rememberedId) {
      setRestoring(false);
      return;
    }

    const controller = new AbortController();
    setRestoring(true);
    getMission(rememberedId, controller.signal)
      .then((remembered) => {
        if (!controller.signal.aborted) {
          setSnapshot(remembered);
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setRestoring(false);
      });
    return () => controller.abort();
  }, []);

  const submit = useCallback(
    async (input: CreateMissionInput): Promise<boolean> => {
      if (submittingRef.current || restoring || active) return false;
      submittingRef.current = true;
      setSubmitting(true);
      setPendingObjective(input.objective);
      rememberSnapshot(null);
      setSnapshot(null);
      setError(null);
      try {
        // Do not abort mission creation when RoomView unmounts during a room
        // switch: the server command is durable and may already have landed.
        const created = await createMission({
          ...input,
          commandId: input.commandId ?? commandIdFor(input.objective),
        });
        clearPendingCommand();
        rememberSnapshot(created);
        setSnapshot(created);
        return true;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        return false;
      } finally {
        submittingRef.current = false;
        setSubmitting(false);
        setPendingObjective(null);
      }
    },
    [active, restoring],
  );

  const missionId = snapshot?.mission.id ?? null;
  const missionState = snapshot?.mission.state ?? null;

  useEffect(() => {
    if (missionId === null || missionState === null || isMissionTerminal(missionState)) {
      return;
    }

    const controller = new AbortController();
    let timer: number | null = null;
    let disposed = false;

    const poll = async (): Promise<void> => {
      try {
        const next = await getMission(missionId, controller.signal);
        if (disposed) return;
        setSnapshot(next);
        setError(null);
        if (!isMissionTerminal(next.mission.state)) {
          timer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
        }
      } catch (caught) {
        if (disposed || controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : String(caught));
        timer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
      }
    };

    timer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      disposed = true;
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [missionId, missionState]);

  const stop = useCallback(
    async (reason: string): Promise<boolean> => {
      if (
        missionId === null ||
        stoppingRef.current ||
        snapshot?.mission.stopNewWork === true ||
        !active
      ) {
        return false;
      }
      stoppingRef.current = true;
      setStopRequestPending(true);
      setError(null);
      try {
        const mission = await stopMission(missionId, reason);
        setSnapshot((current) =>
          current === null ? current : { ...current, mission },
        );
        // Re-read the graph after the stop so every node reflects the durable
        // cancellation boundary rather than a client-side optimistic state.
        const stopped = await getMission(missionId);
        setSnapshot(stopped);
        return true;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        return false;
      } finally {
        stoppingRef.current = false;
        setStopRequestPending(false);
      }
    },
    [active, missionId, snapshot?.mission.stopNewWork],
  );

  return {
    snapshot,
    pendingObjective,
    restoring,
    submitting,
    stopping,
    active,
    error,
    submit,
    stop,
  };
}
