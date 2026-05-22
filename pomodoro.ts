/**
 * Pomodoro Timer Extension for pi
 *
 * Global state is stored in a shared JSON file so every pi session on the same
 * machine sees the same timer.
 */

import { Type } from "@sinclair/typebox";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

type PomodoroState = {
  isRunning: boolean;
  isBreak: boolean;
  remainingSeconds: number;
  workDuration: number;
  breakDuration: number;
  longBreakDuration: number;
  sessionsCompleted: number;
  sessionsUntilLongBreak: number;
  currentFocus: string;
  updatedAt: number;
};

export default function (pi: any) {
  const DEFAULT_WORK_SECONDS = 25 * 60;
  const DEFAULT_BREAK_SECONDS = 5 * 60;
  const DEFAULT_LONG_BREAK_SECONDS = 15 * 60;
  const DEFAULT_SESSIONS_UNTIL_LONG = 4;
  const MAX_FOCUS_LENGTH = 200;
  const MAX_DURATION_MINUTES = 180;
  const STATUS_KEY = "pomodoro-timer";
  const GLOBAL_STATE_PATH = join(homedir(), ".pi", "agent", "pomodoro-state.json");

  const defaultState: PomodoroState = {
    isRunning: false,
    isBreak: false,
    remainingSeconds: DEFAULT_WORK_SECONDS,
    workDuration: DEFAULT_WORK_SECONDS,
    breakDuration: DEFAULT_BREAK_SECONDS,
    longBreakDuration: DEFAULT_LONG_BREAK_SECONDS,
    sessionsCompleted: 0,
    sessionsUntilLongBreak: DEFAULT_SESSIONS_UNTIL_LONG,
    currentFocus: "",
    updatedAt: 0,
  };

  let state: PomodoroState = { ...defaultState };
  let timerInterval: any = null;
  let ctx: any = null;
  let hasAutoStarted = false;

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function isPositiveInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value > 0;
  }

  function isNonNegativeInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
  }

  function truncateFocus(focus: string): string {
    const trimmed = focus.trim();
    return trimmed.length > MAX_FOCUS_LENGTH ? trimmed.slice(0, MAX_FOCUS_LENGTH) : trimmed;
  }

  function parseDurationMinutes(value?: string): number | null {
    if (!value || !/^\d+$/.test(value)) return null;

    const minutes = Number(value);
    if (!Number.isSafeInteger(minutes) || minutes <= 0) return null;
    return Math.min(minutes, MAX_DURATION_MINUTES);
  }

  function normalizeState(data: unknown): PomodoroState | null {
    if (!isRecord(data)) return null;

    return {
      isRunning: typeof data.isRunning === "boolean" ? data.isRunning : defaultState.isRunning,
      isBreak: typeof data.isBreak === "boolean" ? data.isBreak : defaultState.isBreak,
      remainingSeconds: isNonNegativeInteger(data.remainingSeconds)
        ? data.remainingSeconds
        : defaultState.remainingSeconds,
      workDuration: isPositiveInteger(data.workDuration) ? data.workDuration : defaultState.workDuration,
      breakDuration: isPositiveInteger(data.breakDuration) ? data.breakDuration : defaultState.breakDuration,
      longBreakDuration: isPositiveInteger(data.longBreakDuration)
        ? data.longBreakDuration
        : defaultState.longBreakDuration,
      sessionsCompleted: isNonNegativeInteger(data.sessionsCompleted)
        ? data.sessionsCompleted
        : defaultState.sessionsCompleted,
      sessionsUntilLongBreak: isPositiveInteger(data.sessionsUntilLongBreak)
        ? data.sessionsUntilLongBreak
        : defaultState.sessionsUntilLongBreak,
      currentFocus: typeof data.currentFocus === "string" ? data.currentFocus : defaultState.currentFocus,
      updatedAt: isNonNegativeInteger(data.updatedAt) ? data.updatedAt : defaultState.updatedAt,
    };
  }

  function loadStateFromDisk(): PomodoroState | null {
    try {
      const raw = readFileSync(GLOBAL_STATE_PATH, "utf8");
      return normalizeState(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  function ensureStateDirectory() {
    mkdirSync(dirname(GLOBAL_STATE_PATH), { recursive: true });
  }

  function clearTimerInterval() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function beginTimerInterval() {
    if (!timerInterval) {
      timerInterval = setInterval(tickTimer, 1000);
    }
  }

  function updateStatus() {
    if (!ctx) return;
    const theme = ctx.ui.theme;
    const mode = state.isBreak ? "Break" : "Work";
    const time = formatTime(state.remainingSeconds);
    const focus = state.currentFocus ? " 📋 " + state.currentFocus : "";

    if (state.isRunning) {
      ctx.ui.setStatus(STATUS_KEY, theme.fg("accent", "●") + " [Pomodoro " + mode + "] " + time + focus);
    } else {
      ctx.ui.setStatus(STATUS_KEY, "[Pomodoro " + mode + "] " + time + " (paused)" + focus);
    }
  }

  function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return String(mins).padStart(2, "0") + ":" + String(secs).padStart(2, "0");
  }

  function persistState() {
    ensureStateDirectory();
    state.updatedAt = Date.now();
    writeFileSync(GLOBAL_STATE_PATH, JSON.stringify(state, null, 2) + "\n", "utf8");
  }

  function syncStateFromDisk() {
    const diskState = loadStateFromDisk();
    if (!diskState || diskState.updatedAt <= state.updatedAt) return;

    state = diskState;
    if (state.isRunning) {
      beginTimerInterval();
    } else {
      clearTimerInterval();
    }
    updateStatus();
  }

  function handleTimerComplete() {
    clearTimerInterval();
    const completedFocus = state.currentFocus;
    state.isRunning = false;

    if (state.isBreak) {
      state.isBreak = false;
      state.remainingSeconds = state.workDuration;
      state.currentFocus = "";
      ctx?.ui.notify("Break over! Time to focus.", "info");
    } else {
      state.sessionsCompleted++;
      state.sessionsUntilLongBreak--;

      if (completedFocus) {
        ctx?.ui.notify("Session complete: " + completedFocus, "success");
      }

      if (state.sessionsUntilLongBreak <= 0) {
        state.isBreak = true;
        state.remainingSeconds = state.longBreakDuration;
        state.sessionsUntilLongBreak = DEFAULT_SESSIONS_UNTIL_LONG;
        ctx?.ui.notify("Work session " + state.sessionsCompleted + " complete! Take a long break.", "success");
      } else {
        state.isBreak = true;
        state.remainingSeconds = state.breakDuration;
        ctx?.ui.notify("Work session " + state.sessionsCompleted + " complete! Take a short break.", "success");
      }

      state.currentFocus = "";
    }

    persistState();
    updateStatus();
  }

  function tickTimer() {
    syncStateFromDisk();
    if (!state.isRunning) return;

    state.remainingSeconds--;

    if (state.remainingSeconds <= 0) {
      handleTimerComplete();
      return;
    }

    persistState();
    updateStatus();
  }

  function startTimer(focus?: string) {
    syncStateFromDisk();
    if (timerInterval) return;

    if (focus) state.currentFocus = truncateFocus(focus);

    state.isRunning = true;
    persistState();
    updateStatus();
    beginTimerInterval();
  }

  function stopTimer() {
    syncStateFromDisk();
    clearTimerInterval();
    state.isRunning = false;
    persistState();
    updateStatus();
  }

  // Session start - load the shared global state.
  pi.on("session_start", async (_event: any, extensionCtx: any) => {
    ctx = extensionCtx;
    hasAutoStarted = false;
    clearTimerInterval();
    state = { ...defaultState };

    const loadedState = loadStateFromDisk();
    if (loadedState) {
      state = loadedState;
    }

    if (state.isRunning) {
      beginTimerInterval();
    }

    updateStatus();
  });

  // Register command
  pi.registerCommand("pomodoro", {
    description: "Pomodoro: start [focus] | stop | reset | status | focus <task> | set <work> <break> <long>",
    handler: async (args: string, extensionCtx: any) => {
      ctx = extensionCtx;
      const parts = args.trim().split(/\s+/);
      const action = (parts[0] || "").toLowerCase();

      switch (action) {
        case "start": {
          const focus = parts.slice(1).join(" ") || undefined;
          startTimer(focus);

          let msg = "Timer started: " + formatTime(state.remainingSeconds);
          if (state.currentFocus) msg += " [" + state.currentFocus + "]";
          extensionCtx.ui.notify(msg, "info");
          break;
        }

        case "stop":
          stopTimer();
          extensionCtx.ui.notify("Timer paused at " + formatTime(state.remainingSeconds), "info");
          break;

        case "reset":
          syncStateFromDisk();
          stopTimer();
          state.remainingSeconds = state.workDuration;
          state.isBreak = false;
          state.currentFocus = "";
          persistState();
          updateStatus();
          extensionCtx.ui.notify("Timer reset", "info");
          break;

        case "status": {
          syncStateFromDisk();
          const focus = state.currentFocus ? " [" + state.currentFocus + "]" : "";
          extensionCtx.ui.notify(
            (state.isRunning ? "Running" : "Paused") + ": " +
              formatTime(state.remainingSeconds) +
              " (" +
              (state.isBreak ? "break" : "work") +
              ")" +
              focus +
              " | Sessions completed: " + state.sessionsCompleted,
            "info"
          );
          break;
        }

        case "focus": {
          syncStateFromDisk();
          const focus = parts.slice(1).join(" ").trim();
          if (focus) {
            state.currentFocus = truncateFocus(focus);
            persistState();
            updateStatus();
            extensionCtx.ui.notify("Focus set: " + state.currentFocus, "info");
          } else if (state.currentFocus) {
            extensionCtx.ui.notify("Current focus: " + state.currentFocus, "info");
          } else {
            extensionCtx.ui.notify("No focus set. Usage: /pomodoro focus <task>", "info");
          }
          break;
        }

        case "help":
          extensionCtx.ui.notify(
            "Pomodoro: /pomodoro start [focus] | stop | reset | status | focus <task> | set <work> <break> <long>",
            "info"
          );
          break;

        case "set": {
          syncStateFromDisk();
          const workMins = parseDurationMinutes(parts[1]);
          const breakMins = parseDurationMinutes(parts[2]);
          const longMins = parseDurationMinutes(parts[3]);

          if (workMins === null || breakMins === null || longMins === null) {
            extensionCtx.ui.notify(
              "Invalid durations. Use: /pomodoro set <work> <break> <long> (positive whole minutes)",
              "info"
            );
            break;
          }

          state.workDuration = workMins * 60;
          state.breakDuration = breakMins * 60;
          state.longBreakDuration = longMins * 60;

          if (!state.isRunning && !state.isBreak) {
            state.remainingSeconds = state.workDuration;
          }

          persistState();
          updateStatus();
          extensionCtx.ui.notify(
            "Configured: Work " + workMins + "m, Break " + breakMins + "m, Long " + longMins + "m",
            "info"
          );
          break;
        }

        default:
          extensionCtx.ui.notify(
            "Pomodoro: /pomodoro start [focus] | stop | reset | status | focus <task> | set <work> <break> <long>",
            "info"
          );
      }
    },
  });

  // Agent-callable tools
  pi.registerTool({
    name: "pomodoro_start",
    label: "Pomodoro Start",
    description: "Start the Pomodoro timer. Optionally set a focus task for this session.",
    promptSnippet: "Start the Pomodoro timer with an optional focus task",
    parameters: Type.Object({
      focus: Type.Optional(Type.String({ description: "Focus task for this session (optional)" })),
    }),
    async execute(_toolCallId: string, params: { focus?: string }, _signal: any, _onUpdate: any, extensionCtx: any) {
      ctx = extensionCtx;
      startTimer(params.focus);
      let msg = "Pomodoro started: " + formatTime(state.remainingSeconds);
      if (state.currentFocus) msg += " [" + state.currentFocus + "]";
      return { content: [{ type: "text", text: msg }], details: {} };
    },
  });

  pi.registerTool({
    name: "pomodoro_stop",
    label: "Pomodoro Stop",
    description: "Pause the Pomodoro timer.",
    promptSnippet: "Pause the Pomodoro timer",
    parameters: Type.Object({}),
    async execute(_toolCallId: string, _params: any, _signal: any, _onUpdate: any, extensionCtx: any) {
      ctx = extensionCtx;
      stopTimer();
      return { content: [{ type: "text", text: "Pomodoro paused at " + formatTime(state.remainingSeconds) }], details: {} };
    },
  });

  pi.registerTool({
    name: "pomodoro_reset",
    label: "Pomodoro Reset",
    description: "Reset the Pomodoro timer to the start of a work session.",
    promptSnippet: "Reset the Pomodoro timer",
    parameters: Type.Object({}),
    async execute(_toolCallId: string, _params: any, _signal: any, _onUpdate: any, extensionCtx: any) {
      ctx = extensionCtx;
      syncStateFromDisk();
      clearTimerInterval();
      state.isRunning = false;
      state.remainingSeconds = state.workDuration;
      state.isBreak = false;
      state.currentFocus = "";
      persistState();
      updateStatus();
      return { content: [{ type: "text", text: "Pomodoro reset to " + formatTime(state.workDuration) }], details: {} };
    },
  });

  pi.registerTool({
    name: "pomodoro_status",
    label: "Pomodoro Status",
    description: "Get the current Pomodoro timer status: running/paused, time remaining, mode, focus, and sessions completed.",
    promptSnippet: "Get current Pomodoro timer status",
    parameters: Type.Object({}),
    async execute(_toolCallId: string, _params: any, _signal: any, _onUpdate: any, extensionCtx: any) {
      ctx = extensionCtx;
      syncStateFromDisk();
      const focus = state.currentFocus ? " [" + state.currentFocus + "]" : "";
      const text =
        (state.isRunning ? "Running" : "Paused") +
        ": " + formatTime(state.remainingSeconds) +
        " (" + (state.isBreak ? "break" : "work") + ")" +
        focus +
        " | Sessions completed: " + state.sessionsCompleted;
      return { content: [{ type: "text", text }], details: { ...state } };
    },
  });

  pi.registerTool({
    name: "pomodoro_focus",
    label: "Pomodoro Focus",
    description: "Set or update the focus task for the current Pomodoro session.",
    promptSnippet: "Set the Pomodoro focus task",
    parameters: Type.Object({
      focus: Type.String({ description: "The task to focus on" }),
    }),
    async execute(_toolCallId: string, params: { focus: string }, _signal: any, _onUpdate: any, extensionCtx: any) {
      ctx = extensionCtx;
      syncStateFromDisk();
      state.currentFocus = truncateFocus(params.focus);
      persistState();
      updateStatus();
      return { content: [{ type: "text", text: "Focus set: " + state.currentFocus }], details: {} };
    },
  });

  // Keyboard shortcut
  pi.registerShortcut("ctrl+shift+p", {
    description: "Toggle Pomodoro timer",
    handler: async () => {
      if (state.isRunning) {
        stopTimer();
        ctx?.ui.notify("Timer paused at " + formatTime(state.remainingSeconds), "info");
      } else {
        startTimer();
        let msg = "Timer started: " + formatTime(state.remainingSeconds);
        if (state.currentFocus) msg += " [" + state.currentFocus + "]";
        ctx?.ui.notify(msg, "info");
      }
    },
  });

  // Cleanup on shutdown
  pi.on("session_shutdown", () => {
    clearTimerInterval();
  });

  // Append pomodoro info to system prompt
  pi.on("before_agent_start", async (event: any) => {
    const pomodoroInfo = buildPomodoroPrompt();
    return {
      systemPrompt: event.systemPrompt + "\n\n" + pomodoroInfo,
    };
  });

  // Auto-run: start timer when user assigns a task
  pi.on("agent_end", async (event: any) => {
    if (hasAutoStarted || state.isRunning || state.sessionsCompleted > 0) return;
    if (!ctx) return;

    const messages = event.messages || [];
    const lastMessage = messages[messages.length - 1];

    const isTask =
      lastMessage?.content &&
      lastMessage.content.length > 10 &&
      !lastMessage.content.match(/^(hi|hey|hello|thanks|thank you)/i);

    if (isTask) {
      const taskText = lastMessage.content.substring(0, MAX_FOCUS_LENGTH);
      hasAutoStarted = true;
      startTimer(taskText);
      ctx.ui.notify("🍅 Pomodoro started for: " + taskText, "info");
    } else if (messages.length <= 2) {
      hasAutoStarted = true;
      ctx.ui.notify("💡 Tip: Start a pomodoro with /pomodoro start or pomodoro_start tool", "info");
    }
  });

  function buildPomodoroPrompt(): string {
    if (!state.isRunning && state.sessionsCompleted === 0) {
      return `## Pomodoro Timer (REQUIRED)

You MUST use the Pomodoro technique to manage your work sessions. This extension helps maintain focus and prevent burnout.

CRITICAL: When user assigns ANY task or asks you to do something:
1. IMMEDIATELY call pomodoro_start({ focus: "task description" }) as your FIRST action
2. Do NOT read files, run commands, or do any work until pomodoro is started
3. Track time actively - don't let sessions expire unnoticed
4. When work session ends, remind user to take a break

Tools: pomodoro_start, pomodoro_stop, pomodoro_reset, pomodoro_status, pomodoro_focus
Or command: /pomodoro start [focus]`;
    }

    const mode = state.isBreak ? "BREAK" : "WORK";
    const time = formatTime(state.remainingSeconds);
    const focus = state.currentFocus ? ` | Focus: ${state.currentFocus}` : "";
    const sessions = `${state.sessionsCompleted}/${DEFAULT_SESSIONS_UNTIL_LONG}`;
    const status = state.isRunning ? "● RUNNING" : "○ PAUSED";

    if (state.isBreak) {
      return `## Pomodoro Timer [${status}]
${mode} session | ${time} remaining
Sessions completed: ${state.sessionsCompleted}${focus}

Take a break! Step away from the screen.${focus ? ` Then resume: ${focus}` : ""}`;
    }

    return `## Pomodoro Timer [${status}]
${mode} session | ${time} remaining | Session ${sessions}${focus}

Stay focused on the current task. When the timer ends, I'll remind you to take a break.`;
  }
}
