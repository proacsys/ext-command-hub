# Command Hub

Save terminal commands under categories, **globally** — available in every
project/workspace, not tied to one repo. Commands live in VS Code's
`globalState`, so they follow your user profile, not the folder you happen
to have open.

## Install
Search **"Command Hub"** in the Extensions view (Ctrl+Shift+X) and install
it, or grab it from the
[Marketplace](https://marketplace.visualstudio.com/items?itemName=CommandHub.command-hub).
A "Global Commands" icon appears in the Activity Bar.

## Features (v1)

- **Categories & commands** — group commands (Flutter, Git, Docker, ...),
  click any command to run it in the terminal.
- **Export / Import** — top-of-view overflow menu. Export your whole list to
  a JSON file (for backup, or to hand to a teammate); import with a choice
  of **merge** (add to what you have, skipping exact duplicates) or
  **replace** (wipe and load).
- **Filter/search** — the search icon in the view title filters categories
  and commands by name as you type; clear it with the adjacent icon.
- **Placeholder variables** — use `${workspaceFolder}`, `${workspaceFolderBasename}`,
  `${file}`, `${fileBasename}`, `${fileBasenameNoExtension}`, `${fileDirname}`,
  `${fileExtname}` inside a command; they're resolved against whatever
  project/file is active when you run it. Lets one global command adapt per
  project.
- **Run in new terminal (per command)** — toggle when adding/editing a
  command so it always opens a fresh terminal instead of reusing the active
  one (useful for things like dev servers you don't want to interrupt).
- **Confirm before running (per command)** — toggle for anything destructive
  (`flutter clean`, `git push --force`, etc.) so you get a modal prompt
  before it fires.
- **Drag-to-reorder** — drag commands to reorder within/between categories,
  or drag categories to reorder the whole list.
- **Run Last Used Command** — `Ctrl+Alt+R` (`Cmd+Alt+R` on macOS) re-runs
  whatever you last ran, from anywhere, without opening the sidebar.

## Usage
- **+** icon in the view title → add a category.
- Right-click a category → **Add Command** → enter a nickname, the command
  itself, then optionally toggle "new terminal" / "confirm before running".
- Click a command to run it. Right-click for **Edit** / **Delete**.
- Search icon → filter; clear-all icon → clear the filter.
- Overflow (`...`) menu in the view title → **Export** / **Import**.

