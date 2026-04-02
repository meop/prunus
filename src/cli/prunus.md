Manage prunus settings for the current project. Arguments: $ARGUMENTS

Prunus settings are stored in `.prunus/settings.json` files, discovered by walking up from the current working
directory. User-level defaults (`url`, `token`) live in `~/.prunus/settings.json` and are written by the installer — do
not modify those fields here.

**Project-level `.prunus/settings.json` schema:**

```json
{
  "enabled": true,
  "project": "optional-name-override",
  "tree": "code"
}
```

**Settings discovery rule (used by both commands):**

Build an ordered list of settings files as follows:

1. Starting from `$CWD`, walk up the directory tree one level at a time. At each directory `$DIR`, attempt to read
   `$DIR/.prunus/settings.json`. If it succeeds, append that path to the list. If the file does not exist, skip it. To
   get the parent of `$DIR`, run: `deno eval "import{dirname}from'jsr:@std/path';console.log(dirname('$DIR'))"` — stop
   when the result equals `$DIR` (reached filesystem root).
2. After the traversal, attempt to read `$HOME/.prunus/settings.json`. If it succeeds, append it to the list. **Always
   use the resolved `$HOME` value — never use `~` in file paths.**

The result is a list ordered deepest-first: the file closest to cwd is first, and `$HOME/.prunus/settings.json` is last.

Merge the list in order: for each key, the value from the first file in the list that defines it wins. Files later in
the list (further from cwd, including `$HOME/.prunus/settings.json`) are lower priority and only supply values not
already set by an earlier file. Always merge all files completely. If the list is empty, there are no settings.

**Steps — read $ARGUMENTS and act accordingly:**

First, run these two commands to resolve the current and home directories (Deno is cross-platform and always available
on prunus clients):

- `deno eval "console.log(Deno.cwd())"` → store as `$CWD`
- `deno eval "console.log(Deno.env.get('HOME') ?? Deno.env.get('USERPROFILE'))"` → store as `$HOME`

Use these resolved values everywhere below — never use `~` or unresolved shell variables in file paths. Then:

---

**No args:**

Print: `usage: /prunus <command>` followed by the available commands: `init`, `status`, `update`

---

**"status":**

1. Apply the settings discovery rule to build the merged settings
2. If the list is empty, print "no settings found" and stop
3. Print the paths of all files in the list
4. Print all fields as a table with three columns: key, set, and value — sorted alphabetically by key. Always show every
   field. The `set` column is `yes` if the field is explicitly present in the merged settings, `no` if falling back to a
   default. Default values to display when not set:
   - `enabled` → `true`
   - `project` → name of the directory containing the `.prunus/` folder of the deepest project-level settings file
   - `token` → `""` — mask as `******` if set
   - `url` → `http://localhost:9100`
   - `tree` → `""`

---

**"init":**

**Phase 1 — locate or create settings file:**

1. Walk up from `$CWD` toward the root; attempt to read `$DIR/.prunus/settings.json` at each level (do not include
   `$HOME/.prunus/settings.json`). Use the same parent-resolution and stop condition as the discovery rule above.
2. If any were found, use the first (deepest) one as the file to edit and skip to Phase 2
3. If none found, create a new settings file:
   - Default path: `$CWD/.prunus/settings.json` — the client may offer this as a default or let the user specify a
     different path
   - Run `deno eval "await Deno.mkdir('PATH/.prunus',{recursive:true})"` to create the directory, then write `{}` as the
     initial file contents

**Phase 2 — collect field values from the user:**

For each field, check if the key exists in the current JSON. Use `set` if absent, `update` if present.

The client should collect these values from the user in its own UI style (menu, prompts, form, etc.). Required fields
must be provided; optional fields may be omitted.

1. **tree** (mandatory):
   - Ask the user to enter the tree name (e.g. `code`, `recipe`)
   - If key absent: no default; the user must supply a value
   - If key present: show the current value as the default

2. **project** (optional):
   - If key absent: user may provide a value or leave empty to omit the key
   - If key present: user may provide a new value or keep the current one

3. **enabled** (optional, absent = enabled):
   - If key absent: user may explicitly set to `false`; otherwise leave the key absent (enabled by default)
   - If key present: user may change the value or keep the current one

**Phase 3 — write and confirm:**

1. Write the updated JSON to the settings file with 2-space indent, keys sorted alphabetically, preserving any keys not
   touched above
2. Show the final file contents
3. Remind the user to restart the tool for changes to take effect

---

**"update [guidance]":**

1. Apply the settings discovery rule to build the merged settings
2. If `enabled` is false or `tree` is empty, print "prunus is disabled for this project" and stop
3. Compose a summary document from the current session context:
   - Capture decisions made, approaches validated, conclusions reached, and important technical details discovered
   - Omit exploratory attempts that were abandoned, dead ends, and superseded approaches — only what was actually
     resolved
   - If `guidance` is provided, use it to focus or shape what the document covers
   - Write in clear, factual prose — not as a dialogue or transcript
   - Include enough context in each section that a reader unfamiliar with this session can understand the insight
4. Call `mcp__prunus__update_notes` with `{tree: <tree from merged settings>, project, document: <the summary>}`
5. Print: `sent to prunus`

---

Use `deno eval` for all shell operations (`$CWD`, `$HOME`, parent-directory resolution, directory creation) — Deno is
cross-platform and available on all prunus clients. Preserve existing keys when updating — only change keys the user
explicitly answered.
