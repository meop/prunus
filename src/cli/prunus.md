Manage prunus settings for the current project. Arguments: $ARGUMENTS

Prunus settings are stored in `.prunus/settings.json` files, discovered by walking up from the current working
directory. User-level defaults (`url`, `token`) live in `~/.prunus/settings.json` and are written by the installer — do
not modify those fields here.

**Project-level `.prunus/settings.json` schema:**

```json
{
  "enabled": true,
  "project": "optional-name-override",
  "grove": "code"
}
```

**Settings discovery rule (used by both commands):**

Run this in Bash to collect all settings files, deepest-first:

```bash
dir=$(pwd); while [ "$dir" != "/" ]; do test -f "$dir/.prunus/settings.json" && echo "$dir/.prunus/settings.json"; dir=$(dirname "$dir"); done
```

Read each file in the order returned and merge them: for each key, the value from the first (deepest) file that defines
it wins. If the deepest file explicitly sets `"enabled": false`, stop — prunus is disabled, ignore remaining files. If
no files are found, the result is "no settings found".

**Steps — read $ARGUMENTS and act accordingly:**

First, run `pwd` in Bash to get the current working directory. Then:

---

**No args:**

Print: `usage: /prunus <command>` followed by the available commands: `init`, `status`, `update`

---

**"status":**

1. Apply the settings discovery rule, collecting all settings files found
2. Read `~/.prunus/settings.json` for user settings
3. If no settings files found, print "no settings found" and stop
4. If more than one settings file was found, print the list of paths in traversal order (deepest first)
5. Print all fields as a table with three columns: key, set, and value — sorted alphabetically by key. Always show every
   field. The `set` column is `yes` if the field is explicitly present in the merged settings, `no` if falling back to a
   default. Default values to display when not set:
   - `enabled` → `true`
   - `project` → directory name of the settings file location
   - `token` → `""`
   - `url` → `http://localhost:9100`
   - `grove` → `""` Mask `token` as `******` if set.

---

**"init":**

**Phase 1 — locate or create settings file:**

1. Apply the settings discovery rule
2. If an active settings file is found, use it and skip to Phase 2
3. If none found, prompt: `? create settings file [<cwd>/.prunus/settings.json]:`
   - Enter accepts the default path; user may type a different path
   - `mkdir -p` the `.prunus` directory, start with `{}`

**Phase 2 — prompt for each field:**

For each field, check if the key exists in the current JSON. Use `set` if absent, `update` if present.

Prompt style mirrors the installer — `?` prefix, `[default]` for suggested value, `(current)` for existing value:

1. **grove** (mandatory):
   - Call `mcp__prunus__list_trees` and extract grove names
   - Display as a numbered list
   - If key absent: `? set grove [1] (<grove-name>):` — default is item 1
   - If key present: `? update grove (<current-grove>):` — show numbered list above, enter keeps current
   - Re-prompt if input is not a valid number or name

2. **project** (optional):
   - If key absent: `? set project name [leave empty to omit]:`
     - Enter omits the key entirely
   - If key present: `? update project name (<current>):`
     - Enter keeps the current value

3. **enabled** (optional, absent = enabled):
   - If key absent: `? set enabled [y, [n]]:` — enter leaves key absent (enabled by default)
   - If key present and true: `? update enabled [y, [n]]:`
   - If key present and false: `? update enabled [n, [y]]:`
   - Enter keeps existing state; only write the key if user explicitly answers

**Phase 3 — write and confirm:**

1. Write the updated JSON with 2-space indent, keys sorted alphabetically, preserving any keys not touched above
2. Show the final file contents
3. Remind the user to restart the tool for changes to take effect

---

---

**"update [guidance]":**

1. Apply the settings discovery rule to get the merged settings; also read `~/.prunus/settings.json` for user settings
2. If `enabled` is false or `tree` is empty, print "prunus is disabled for this project" and stop
3. Compose a summary document from the current session context:
   - Capture decisions made, approaches validated, conclusions reached, and important technical details discovered
   - Omit exploratory attempts that were abandoned, dead ends, and superseded approaches — only what was actually
     resolved
   - If `guidance` is provided, use it to focus or shape what the document covers
   - Write in clear, factual prose — not as a dialogue or transcript
   - Include enough context in each section that a reader unfamiliar with this session can understand the insight
4. Call `mcp__prunus__update_tree` with `{tree, project, document: <the summary>}`
5. Print: `sent to prunus`

---

Use the Read and Write tools for all file operations. Use Bash only for `pwd` and `mkdir -p`. Preserve existing keys
when updating — only change keys the user explicitly answered.
