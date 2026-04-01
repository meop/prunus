Manage prunus settings for the current project. Arguments: $ARGUMENTS

Prunus settings are stored in `.prunus/settings.json` files, discovered by walking up from the current working
directory. User-level defaults (server URL, auth token) live in `~/.prunus/settings.json` and are written by the
installer — do not modify those fields here.

**Project-level `.prunus/settings.json` schema:**

```json
{
  "vault": "code",
  "enabled": true,
  "project": "optional-name-override"
}
```

**Steps — read $ARGUMENTS and act accordingly:**

First, run `pwd` in Bash to get the current working directory. Then:

**No args or "status":**

1. Walk up from cwd, checking each directory for `.prunus/settings.json` until one is found or root
2. Read `~/.prunus/settings.json` for user settings (serverUrl, authToken)
3. Report: path of settings file found (or "none found"), effective vault, enabled state, project name in use, serverUrl
   from user settings

**"on":**

1. Walk up from cwd to find the nearest `.prunus/settings.json`
2. If none found, create `.prunus/settings.json` in cwd (mkdir `.prunus` first)
3. Read existing JSON (or start with `{}`), set `"enabled": true`, write back with 2-space indent
4. Confirm the path updated

**"off":**

1. Walk up from cwd to find the nearest `.prunus/settings.json`
2. If none found, create `.prunus/settings.json` in cwd
3. Read existing JSON (or start with `{}`), set `"enabled": false`, write back
4. Confirm the path updated

**"vault \<name\>":**

1. Walk up from cwd to find the nearest `.prunus/settings.json`
2. If none found, create `.prunus/settings.json` in cwd
3. Read existing JSON (or start with `{}`), set `"vault": "<name>"`, write back
4. Confirm the path updated

**"init":**

1. Check if `.prunus/settings.json` already exists in cwd; if so, show its contents and stop
2. Ask: "Which vault? [code]: " — use "code" if the user presses enter
3. Create `.prunus/` directory in cwd, write `.prunus/settings.json`: `{ "vault": "<name>", "enabled": true }`
4. Confirm path created and remind the user to restart the tool for the change to take effect

Use the Read and Write tools for all file operations. Use Bash only for `pwd` and `mkdir`. Preserve existing keys when
updating a settings file — only change the key being set.
