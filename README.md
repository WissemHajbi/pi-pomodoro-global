# Global Pomodoro Timer Extension for pi

A Pomodoro technique timer extension for the [pi coding agent](https://github.com/badlogic/pi-mono).

This fork stores state in a shared JSON file, so every pi session on the same machine uses the same timer.

## Features

- **Configurable timer**: Set work, break, and long break durations
- **Focus tracking**: Set focus when starting or mid-session
- **Visual status**: Shows timer and focus in the footer status bar
- **Commands**: Use `/pomodoro` for quick actions
- **Agent tools**: The AI agent can start/stop/check the timer directly
- **Persistence**: State survives session restarts
- **Global sharing**: One shared timer across all pi sessions on the same machine
- **Notifications**: Alerts when sessions complete
- **System prompt integration**: Timer status injected into LLM context
- **Auto-run**: On new sessions, prompts to start a pomodoro

## Installation

```bash
pi install npm:pi-pomodoro-global
```

## Usage

### Commands

| Command | Description |
|---------|-------------|
| `/pomodoro start [focus]` | Start timer, optional focus task |
| `/pomodoro stop` | Pause timer |
| `/pomodoro reset` | Reset to work session |
| `/pomodoro status` | Show current status |
| `/pomodoro focus <task>` | Set/update current focus |
| `/pomodoro set <work> <break> <long>` | Configure durations (minutes, max 180 each) |
| `/pomodoro help` | Show usage information |

### Examples

```bash
# Start with default 25min work session
/pomodoro start

# Start with focus task
/pomodoro start Write API documentation

# Start with focus and default work session
/pomodoro start Fix authentication bug

# Change focus mid-session
/pomodoro focus Review PR #456

# Check current status
/pomodoro status

# Pause timer
/pomodoro stop

# Reset timer
/pomodoro reset

# Configure custom durations
/pomodoro set 30 10 20  # 30min work, 10min break, 20min long break
```

### Global State

State is stored at:

```bash
~/.pi/agent/pomodoro-state.json
```

If multiple pi instances write at the same time, the newest write wins.

### Agent Tools

The AI agent can control the timer directly without user intervention:

| Tool | Description |
|------|-------------|
| `pomodoro_start` | Start the timer (optional `focus` param) |
| `pomodoro_stop` | Pause the timer |
| `pomodoro_reset` | Reset to work session |
| `pomodoro_status` | Get current status |
| `pomodoro_focus` | Set/update focus task |

Just ask: *"start a pomodoro session"* or *"check pomodoro status"*.

### Keyboard Shortcut

- `Ctrl+Shift+P` - Toggle timer start/stop

### Auto-Run Behavior

The extension automatically:
- Injects timer status into the system prompt so the LLM always knows the current session
- Suggests starting a pomodoro on fresh sessions
- Reminds about breaks when work sessions complete

The LLM can control the timer without user intervention - just say "start a pomodoro" or "check timer status".

## Default Settings

- **Work duration**: 25 minutes
- **Break duration**: 5 minutes
- **Long break**: 15 minutes (after 4 work sessions)

## Files

- `pomodoro.ts` - The extension source
- `pomodoro.test.ts` - Core logic unit tests
- `pomodoro.integration.test.ts` - Integration tests
- `pomodoro.security.test.ts` - Security tests
- `README.md` - This documentation

## Known Limitations

- **Timer precision**: Uses `setInterval` with 1-second ticks. Over long sessions, small drift may accumulate (typically negligible for 25-minute sessions).

## Testing

```bash
bun test
```

All 85 tests pass across 3 test files:
- `pomodoro.test.ts` — Core logic unit tests (time formatting, tick logic, session transitions)
- `pomodoro.integration.test.ts` — Integration tests (commands, state restoration, edge cases)
- `pomodoro.security.test.ts` — Security tests (prototype pollution, input validation, type confusion)

## Publishing to npm

This repo is configured to publish automatically from GitHub Actions when you push a version tag matching `v*`.

### One-time setup

1. In npm, create an automation token with publish access for your account.
2. In GitHub, add the token as an Actions secret named `NPM_TOKEN`.
3. Make sure the package name `pi-pomodoro-global` belongs to your npm account.

### Release a new version

```bash
npm version patch
git push
git push --tags
```

You can also use `minor` or `major` instead of `patch`.

### GitHub Actions

The workflow is in `.github/workflows/publish.yml` and publishes the package to npm on tagged releases.
