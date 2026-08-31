import * as vscode from 'vscode';
import { randomUUID } from 'crypto';

interface SavedCommand {
  id: string;
  label: string;
  command: string;
  runInNewTerminal?: boolean;
  confirmBeforeRun?: boolean;
}

interface Category {
  id: string;
  name: string;
  commands: SavedCommand[];
}

interface StoreShape {
  categories: Category[];
}

interface LastRun {
  categoryId: string;
  commandId: string;
}

const STORE_KEY = 'globalCommandRunner.data';
const LAST_RUN_KEY = 'globalCommandRunner.lastRun';

// ---------- Storage ----------

class CommandStore {
  constructor(private context: vscode.ExtensionContext) {}

  read(): StoreShape {
    return this.context.globalState.get<StoreShape>(STORE_KEY) ?? { categories: [] };
  }

  private async write(data: StoreShape): Promise<void> {
    // globalState persists once per VS Code user profile, not per workspace —
    // this is what makes commands available in every project.
    await this.context.globalState.update(STORE_KEY, data);
  }

  getCategories(): Category[] {
    return this.read().categories;
  }

  findCommand(categoryId: string, commandId: string): SavedCommand | undefined {
    return this.read().categories.find(c => c.id === categoryId)?.commands.find(c => c.id === commandId);
  }

  async addCategory(name: string): Promise<void> {
    const data = this.read();
    data.categories.push({ id: randomUUID(), name, commands: [] });
    await this.write(data);
  }

  async deleteCategory(categoryId: string): Promise<void> {
    const data = this.read();
    data.categories = data.categories.filter(c => c.id !== categoryId);
    await this.write(data);
  }

  async addCommand(categoryId: string, label: string, command: string, runInNewTerminal: boolean, confirmBeforeRun: boolean): Promise<void> {
    const data = this.read();
    const cat = data.categories.find(c => c.id === categoryId);
    if (!cat) return;
    cat.commands.push({ id: randomUUID(), label, command, runInNewTerminal, confirmBeforeRun });
    await this.write(data);
  }

  async editCommand(categoryId: string, commandId: string, label: string, command: string, runInNewTerminal: boolean, confirmBeforeRun: boolean): Promise<void> {
    const data = this.read();
    const cmd = data.categories.find(c => c.id === categoryId)?.commands.find(c => c.id === commandId);
    if (!cmd) return;
    cmd.label = label;
    cmd.command = command;
    cmd.runInNewTerminal = runInNewTerminal;
    cmd.confirmBeforeRun = confirmBeforeRun;
    await this.write(data);
  }

  async deleteCommand(categoryId: string, commandId: string): Promise<void> {
    const data = this.read();
    const cat = data.categories.find(c => c.id === categoryId);
    if (!cat) return;
    cat.commands = cat.commands.filter(c => c.id !== commandId);
    await this.write(data);
  }

  async replaceAll(data: StoreShape): Promise<void> {
    await this.write(data);
  }

  async mergeIn(incoming: StoreShape): Promise<void> {
    const data = this.read();
    for (const incomingCat of incoming.categories) {
      let cat = data.categories.find(c => c.name.toLowerCase() === incomingCat.name.toLowerCase());
      if (!cat) {
        cat = { id: randomUUID(), name: incomingCat.name, commands: [] };
        data.categories.push(cat);
      }
      for (const cmd of incomingCat.commands) {
        const dup = cat.commands.find(c => c.label === cmd.label && c.command === cmd.command);
        if (!dup) {
          cat.commands.push({ ...cmd, id: randomUUID() });
        }
      }
    }
    await this.write(data);
  }

  // ---- reordering ----

  async moveCategory(categoryId: string, beforeCategoryId: string | undefined): Promise<void> {
    const data = this.read();
    const idx = data.categories.findIndex(c => c.id === categoryId);
    if (idx === -1) return;
    const [cat] = data.categories.splice(idx, 1);
    if (!beforeCategoryId) {
      data.categories.push(cat);
    } else {
      const targetIdx = data.categories.findIndex(c => c.id === beforeCategoryId);
      data.categories.splice(targetIdx === -1 ? data.categories.length : targetIdx, 0, cat);
    }
    await this.write(data);
  }

  async moveCommand(fromCategoryId: string, commandId: string, toCategoryId: string, beforeCommandId: string | undefined): Promise<void> {
    const data = this.read();
    const fromCat = data.categories.find(c => c.id === fromCategoryId);
    const toCat = data.categories.find(c => c.id === toCategoryId);
    if (!fromCat || !toCat) return;
    const idx = fromCat.commands.findIndex(c => c.id === commandId);
    if (idx === -1) return;
    const [cmd] = fromCat.commands.splice(idx, 1);
    if (!beforeCommandId) {
      toCat.commands.push(cmd);
    } else {
      const targetIdx = toCat.commands.findIndex(c => c.id === beforeCommandId);
      toCat.commands.splice(targetIdx === -1 ? toCat.commands.length : targetIdx, 0, cmd);
    }
    await this.write(data);
  }
}

// ---------- Variable resolution ----------

function resolveVariables(command: string): string {
  const editor = vscode.window.activeTextEditor;
  const folder = vscode.workspace.workspaceFolders?.[0];

  const replacements: Record<string, string> = {};
  if (folder) {
    replacements['${workspaceFolder}'] = folder.uri.fsPath;
    replacements['${workspaceFolderBasename}'] = folder.name;
  }
  if (editor) {
    const doc = editor.document;
    const path = require('path');
    replacements['${file}'] = doc.uri.fsPath;
    replacements['${fileBasename}'] = path.basename(doc.uri.fsPath);
    replacements['${fileBasenameNoExtension}'] = path.basename(doc.uri.fsPath, path.extname(doc.uri.fsPath));
    replacements['${fileDirname}'] = path.dirname(doc.uri.fsPath);
    replacements['${fileExtname}'] = path.extname(doc.uri.fsPath);
  }

  let result = command;
  for (const [token, value] of Object.entries(replacements)) {
    result = result.split(token).join(value);
  }
  return result;
}

// ---------- Tree ----------

type TreeNode =
  | { kind: 'category'; category: Category }
  | { kind: 'command'; category: Category; command: SavedCommand };

const DRAG_MIME = 'application/vnd.code.tree.globalcommandrunnerview';

class CommandTreeProvider implements vscode.TreeDataProvider<TreeNode>, vscode.TreeDragAndDropController<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  dropMimeTypes = [DRAG_MIME];
  dragMimeTypes = ['text/uri-list'];

  filterText = '';

  constructor(private store: CommandStore) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    if (element.kind === 'category') {
      const item = new vscode.TreeItem(element.category.name, vscode.TreeItemCollapsibleState.Expanded);
      item.contextValue = 'category';
      item.iconPath = new vscode.ThemeIcon('folder');
      item.id = `cat:${element.category.id}`;
      return item;
    } else {
      const item = new vscode.TreeItem(element.command.label, vscode.TreeItemCollapsibleState.None);
      item.contextValue = 'command';
      const badges: string[] = [];
      if (element.command.runInNewTerminal) badges.push('new terminal');
      if (element.command.confirmBeforeRun) badges.push('confirm');
      item.description = badges.length ? `${element.command.command}  [${badges.join(', ')}]` : element.command.command;
      item.tooltip = element.command.command;
      item.iconPath = new vscode.ThemeIcon(element.command.confirmBeforeRun ? 'shield' : 'terminal');
      item.id = `cmd:${element.category.id}:${element.command.id}`;
      item.command = {
        command: 'globalCommandRunner.runCommand',
        title: 'Run Command',
        arguments: [{ kind: 'command', category: element.category, command: element.command }]
      };
      return item;
    }
  }

  getChildren(element?: TreeNode): TreeNode[] {
    const filter = this.filterText.trim().toLowerCase();

    if (!element) {
      let categories = this.store.getCategories();
      if (filter) {
        categories = categories
          .map(cat => ({
            ...cat,
            commands: cat.commands.filter(
              c => c.label.toLowerCase().includes(filter) || c.command.toLowerCase().includes(filter)
            )
          }))
          .filter(cat => cat.name.toLowerCase().includes(filter) || cat.commands.length > 0);
      }
      return categories.map(category => ({ kind: 'category', category } as TreeNode));
    }
    if (element.kind === 'category') {
      let commands = element.category.commands;
      if (filter && !element.category.name.toLowerCase().includes(filter)) {
        commands = commands.filter(
          c => c.label.toLowerCase().includes(filter) || c.command.toLowerCase().includes(filter)
        );
      }
      return commands.map(command => ({ kind: 'command', category: element.category, command } as TreeNode));
    }
    return [];
  }

  // ---- drag and drop reordering ----

  async handleDrag(source: readonly TreeNode[], dataTransfer: vscode.DataTransfer): Promise<void> {
    const node = source[0];
    if (!node) return;
    const payload =
      node.kind === 'category'
        ? { kind: 'category', categoryId: node.category.id }
        : { kind: 'command', categoryId: node.category.id, commandId: node.command.id };
    dataTransfer.set(DRAG_MIME, new vscode.DataTransferItem(JSON.stringify(payload)));
  }

  async handleDrop(target: TreeNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    const raw = dataTransfer.get(DRAG_MIME);
    if (!raw) return;
    const payload = JSON.parse(await raw.asString()) as
      | { kind: 'category'; categoryId: string }
      | { kind: 'command'; categoryId: string; commandId: string };

    if (payload.kind === 'category') {
      const beforeId = target?.kind === 'category' ? target.category.id : target?.kind === 'command' ? target.category.id : undefined;
      await this.store.moveCategory(payload.categoryId, beforeId);
    } else {
      if (!target) return;
      const toCategoryId = target.kind === 'category' ? target.category.id : target.category.id;
      const beforeCommandId = target.kind === 'command' ? target.command.id : undefined;
      await this.store.moveCommand(payload.categoryId, payload.commandId, toCategoryId, beforeCommandId);
    }
    this.refresh();
  }
}

// ---------- Terminal execution ----------

let scratchTerminal: vscode.Terminal | undefined;

function runInTerminal(command: string, forceNew: boolean, label: string) {
  const resolved = resolveVariables(command);
  let terminal: vscode.Terminal;
  if (forceNew) {
    terminal = vscode.window.createTerminal(label);
  } else {
    terminal = vscode.window.activeTerminal ?? vscode.window.createTerminal('Global Commands');
  }
  terminal.show();
  terminal.sendText(resolved);
}

// ---------- Add/Edit flow ----------

async function promptCommandDetails(existing?: SavedCommand): Promise<{ label: string; command: string; runInNewTerminal: boolean; confirmBeforeRun: boolean } | undefined> {
  const label = await vscode.window.showInputBox({
    prompt: 'Nickname for this command (e.g. "Build APK")',
    value: existing?.label
  });
  if (!label) return undefined;

  const command = await vscode.window.showInputBox({
    prompt: 'Actual command to run. You can use ${workspaceFolder}, ${file}, ${fileBasename}, ${fileDirname}',
    value: existing?.command,
    placeHolder: 'flutter build apk --target=${file}'
  });
  if (!command) return undefined;

  const options = await vscode.window.showQuickPick(
    [
      { label: 'Run in a new terminal each time', picked: existing?.runInNewTerminal ?? false, id: 'newTerminal' },
      { label: 'Ask for confirmation before running', picked: existing?.confirmBeforeRun ?? false, id: 'confirm' }
    ],
    { canPickMany: true, placeHolder: 'Optional settings (toggle with space, Enter to confirm)' }
  );
  const picked = options ?? [];

  return {
    label,
    command,
    runInNewTerminal: picked.some(p => p.id === 'newTerminal'),
    confirmBeforeRun: picked.some(p => p.id === 'confirm')
  };
}

// ---------- Activation ----------

export function activate(context: vscode.ExtensionContext) {
  const store = new CommandStore(context);
  const provider = new CommandTreeProvider(store);

  vscode.window.createTreeView('globalCommandRunnerView', {
    treeDataProvider: provider,
    dragAndDropController: provider
  });

  const runNode = async (node: TreeNode) => {
    if (node.kind !== 'command') return;
    const cmd = node.command;

    if (cmd.confirmBeforeRun) {
      const confirm = await vscode.window.showWarningMessage(`Run "${cmd.label}"?\n\n${cmd.command}`, { modal: true }, 'Run');
      if (confirm !== 'Run') return;
    }

    runInTerminal(cmd.command, !!cmd.runInNewTerminal, cmd.label);
    await context.globalState.update(LAST_RUN_KEY, { categoryId: node.category.id, commandId: cmd.id } as LastRun);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('globalCommandRunner.refresh', () => provider.refresh()),

    vscode.commands.registerCommand('globalCommandRunner.search', async () => {
      const value = await vscode.window.showInputBox({
        prompt: 'Filter categories and commands by name',
        value: provider.filterText
      });
      if (value === undefined) return;
      provider.filterText = value;
      provider.refresh();
    }),

    vscode.commands.registerCommand('globalCommandRunner.clearFilter', () => {
      provider.filterText = '';
      provider.refresh();
    }),

    vscode.commands.registerCommand('globalCommandRunner.addCategory', async () => {
      const name = await vscode.window.showInputBox({ prompt: 'Category name (e.g. Flutter, Git, Docker)' });
      if (!name) return;
      await store.addCategory(name);
      provider.refresh();
    }),

    vscode.commands.registerCommand('globalCommandRunner.addCommand', async (node?: TreeNode) => {
      const categories = store.getCategories();
      if (categories.length === 0) {
        vscode.window.showWarningMessage('Create a category first.');
        return;
      }

      let category: Category | undefined;
      if (node && node.kind === 'category') {
        category = node.category;
      } else {
        const pick = await vscode.window.showQuickPick(categories.map(c => c.name), { placeHolder: 'Choose a category' });
        category = categories.find(c => c.name === pick);
      }
      if (!category) return;

      const details = await promptCommandDetails();
      if (!details) return;

      await store.addCommand(category.id, details.label, details.command, details.runInNewTerminal, details.confirmBeforeRun);
      provider.refresh();
    }),

    vscode.commands.registerCommand('globalCommandRunner.runCommand', runNode),

    vscode.commands.registerCommand('globalCommandRunner.runLastCommand', async () => {
      const last = context.globalState.get<LastRun>(LAST_RUN_KEY);
      if (!last) {
        vscode.window.showInformationMessage('No command has been run yet.');
        return;
      }
      const cmd = store.findCommand(last.categoryId, last.commandId);
      const cat = store.getCategories().find(c => c.id === last.categoryId);
      if (!cmd || !cat) {
        vscode.window.showWarningMessage('The last used command no longer exists.');
        return;
      }
      await runNode({ kind: 'command', category: cat, command: cmd });
    }),

    vscode.commands.registerCommand('globalCommandRunner.editCommand', async (node: TreeNode) => {
      if (node.kind !== 'command') return;
      const details = await promptCommandDetails(node.command);
      if (!details) return;
      await store.editCommand(node.category.id, node.command.id, details.label, details.command, details.runInNewTerminal, details.confirmBeforeRun);
      provider.refresh();
    }),

    vscode.commands.registerCommand('globalCommandRunner.deleteCommand', async (node: TreeNode) => {
      if (node.kind !== 'command') return;
      await store.deleteCommand(node.category.id, node.command.id);
      provider.refresh();
    }),

    vscode.commands.registerCommand('globalCommandRunner.deleteCategory', async (node: TreeNode) => {
      if (node.kind !== 'category') return;
      const confirm = await vscode.window.showWarningMessage(
        `Delete category "${node.category.name}" and all its commands?`,
        { modal: true },
        'Delete'
      );
      if (confirm !== 'Delete') return;
      await store.deleteCategory(node.category.id);
      provider.refresh();
    }),

    vscode.commands.registerCommand('globalCommandRunner.exportCommands', async () => {
      const data = store.read();
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file('global-commands-export.json'),
        filters: { JSON: ['json'] }
      });
      if (!uri) return;
      await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(data, null, 2), 'utf8'));
      vscode.window.showInformationMessage(`Exported ${data.categories.length} categories to ${uri.fsPath}`);
    }),

    vscode.commands.registerCommand('globalCommandRunner.importCommands', async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { JSON: ['json'] }
      });
      if (!uris || uris.length === 0) return;

      let parsed: StoreShape;
      try {
        const bytes = await vscode.workspace.fs.readFile(uris[0]);
        parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
        if (!Array.isArray(parsed.categories)) throw new Error('Invalid format');
      } catch (err) {
        vscode.window.showErrorMessage('Could not parse that file as a Global Command Runner export.');
        return;
      }

      const mode = await vscode.window.showQuickPick(
        [
          { label: 'Merge into existing commands', id: 'merge' },
          { label: 'Replace all existing commands', id: 'replace' }
        ],
        { placeHolder: 'How should this import be applied?' }
      );
      if (!mode) return;

      if (mode.id === 'replace') {
        await store.replaceAll(parsed);
      } else {
        await store.mergeIn(parsed);
      }
      provider.refresh();
      vscode.window.showInformationMessage('Import complete.');
    })
  );
}

export function deactivate() {}
