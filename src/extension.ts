import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { spawn, ChildProcess } from 'child_process';

const SUPPORTED_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.apng']);

type AvifSettings = {
  crf: number;
  speed: number;
  lossless: boolean;
  recursive: boolean;
  outDir: string;
  overwrite: boolean;
  jobs: number;
  autoInstallOnMac: boolean;
};

function getSettings(): AvifSettings {
  const cfg = vscode.workspace.getConfiguration('avifConvert');
  return {
    crf: cfg.get<number>('crf', 20),
    speed: cfg.get<number>('speed', 6),
    lossless: cfg.get<boolean>('lossless', false),
    recursive: cfg.get<boolean>('recursive', true),
    outDir: cfg.get<string>('outDir', ''),
    overwrite: cfg.get<boolean>('overwrite', false),
    jobs: cfg.get<number>('jobs', 0),
    autoInstallOnMac: cfg.get<boolean>('autoInstallOnMac', true)
  };
}

function isMac(): boolean {
  return process.platform === 'darwin';
}

/**
 * Build a PATH that includes common Homebrew locations.
 * VSCode extensions often don't inherit the user's shell PATH.
 */
function getEnhancedPath(): string {
  const existing = process.env.PATH || '';
  const extraPaths = [
    '/opt/homebrew/bin',      // Apple Silicon Homebrew
    '/usr/local/bin',         // Intel Homebrew / common
    '/usr/bin',
    '/bin'
  ];
  const parts = existing.split(':');
  for (const p of extraPaths) {
    if (!parts.includes(p)) parts.push(p);
  }
  return parts.join(':');
}

function spawnAndCapture(
  command: string,
  args: string[],
  opts: { cwd?: string; onStdout?: (s: string) => void; onStderr?: (s: string) => void } = {}
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let resolved = false;
    const done = (exitCode: number, stdout: string, stderr: string) => {
      if (resolved) return;
      resolved = true;
      resolve({ exitCode, stdout, stderr });
    };

    const child = spawn(command, args, {
      cwd: opts.cwd,
      shell: false,
      env: { ...process.env, PATH: getEnhancedPath() }
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => {
      const s = String(d);
      stdout += s;
      opts.onStdout?.(s);
    });
    child.stderr.on('data', (d) => {
      const s = String(d);
      stderr += s;
      opts.onStderr?.(s);
    });
    child.on('error', (err) => {
      stderr += String(err);
      done(127, stdout, stderr);
    });
    child.on('close', (code) => done(code ?? 0, stdout, stderr));
  });
}

/**
 * Spawn avifenc and return the child process for cancellation support.
 */
function spawnAvifenc(
  args: string[]
): { promise: Promise<{ exitCode: number; stdout: string; stderr: string }>; child: ChildProcess } {
  let childRef: ChildProcess | null = null;
  let stdout = '';
  let stderr = '';

  const promise = new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve) => {
    let resolved = false;
    const done = (exitCode: number) => {
      if (resolved) return;
      resolved = true;
      resolve({ exitCode, stdout, stderr });
    };

    const child = spawn('avifenc', args, {
      shell: false,
      env: { ...process.env, PATH: getEnhancedPath() }
    });
    childRef = child;

    child.stdout.on('data', (d) => { stdout += String(d); });
    child.stderr.on('data', (d) => { stderr += String(d); });
    child.on('error', (err) => {
      stderr += String(err);
      done(127);
    });
    child.on('close', (code) => done(code ?? 0));
  });

  // childRef is assigned synchronously before promise handlers run
  return { promise, child: childRef! };
}

async function ensureAvifEnc(output: vscode.OutputChannel): Promise<boolean> {
  const settings = getSettings();
  const check = await spawnAndCapture('avifenc', ['--version']);
  if (check.exitCode === 0) return true;

  if (!isMac() || !settings.autoInstallOnMac) {
    vscode.window.showErrorMessage(
      "Could not find 'avifenc' (libavif). Install it and try again. macOS: brew install libavif"
    );
    output.appendLine(check.stderr || check.stdout);
    return false;
  }

  const choice = await vscode.window.showWarningMessage(
    "Could not find 'avifenc'. Install via Homebrew now? (brew install libavif)",
    'Install',
    'Cancel'
  );
  if (choice !== 'Install') return false;

  output.appendLine('[avif-convertor] Installing libavif via Homebrew…');
  const install = await spawnAndCapture('brew', ['install', 'libavif'], {
    onStdout: (s) => output.append(s),
    onStderr: (s) => output.append(s)
  });

  if (install.exitCode !== 0) {
    vscode.window.showErrorMessage('Homebrew install failed. See output for details.');
    return false;
  }

  const recheck = await spawnAndCapture('avifenc', ['--version']);
  if (recheck.exitCode !== 0) {
    vscode.window.showErrorMessage("Installed libavif but still can't run 'avifenc'. See output for details.");
    output.appendLine(recheck.stderr || recheck.stdout);
    return false;
  }

  return true;
}

function isSupportedFile(p: string): boolean {
  return SUPPORTED_EXTS.has(path.extname(p).toLowerCase());
}

async function collectFilesFromDir(dirPath: string, recursive: boolean): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dirPath, e.name);
    if (e.isDirectory()) {
      if (recursive) out.push(...(await collectFilesFromDir(full, true)));
      continue;
    }
    if (e.isFile() && isSupportedFile(full)) out.push(full);
  }
  return out;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function humanBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function calcReduction(before: number, after: number): string {
  if (before <= 0) return '';
  const pct = ((before - after) / before) * 100;
  return `${pct >= 0 ? '-' : '+'}${Math.abs(pct).toFixed(1)}%`;
}

function resolveOutPath(
  inputFile: string,
  outDir: string,
  preserveRootDir: string | null
): { outFile: string; outDirUsed: string } {
  const baseName = path.basename(inputFile, path.extname(inputFile)) + '.avif';
  if (!outDir) {
    return { outFile: path.join(path.dirname(inputFile), baseName), outDirUsed: path.dirname(inputFile) };
  }
  if (!preserveRootDir) {
    return { outFile: path.join(outDir, baseName), outDirUsed: outDir };
  }
  const rel = path.relative(preserveRootDir, path.dirname(inputFile));
  const targetDir = path.join(outDir, rel);
  return { outFile: path.join(targetDir, baseName), outDirUsed: targetDir };
}

async function convertOne(
  inputFile: string,
  settings: AvifSettings,
  preserveRootDir: string | null,
  output: vscode.OutputChannel,
  token: vscode.CancellationToken
): Promise<{ status: 'ok' | 'skipped' | 'error' | 'cancelled'; message: string }> {
  const { outFile, outDirUsed } = resolveOutPath(inputFile, settings.outDir, preserveRootDir);

  if (!settings.overwrite && (await pathExists(outFile))) {
    return { status: 'skipped', message: `Skip (exists): ${outFile}` };
  }

  await fs.mkdir(outDirUsed, { recursive: true });

  const before = await fs.stat(inputFile).then((st) => st.size).catch(() => 0);

  const args: string[] = [];
  if (settings.lossless) args.push('--lossless');
  args.push('--min', String(settings.crf), '--max', String(settings.crf));
  args.push('--speed', String(settings.speed));
  if (settings.jobs > 0) args.push('-j', String(settings.jobs));
  args.push(inputFile, outFile);

  const { promise, child } = spawnAvifenc(args);

  // Kill the process if user cancels
  const onCancel = token.onCancellationRequested(() => {
    child.kill('SIGTERM');
  });

  try {
    const res = await promise;

    if (token.isCancellationRequested) {
      // Clean up partial output file
      await fs.unlink(outFile).catch(() => {});
      return { status: 'cancelled', message: `Cancelled: ${inputFile}` };
    }

    if (res.exitCode !== 0) {
      output.appendLine(`[avifenc] ${inputFile}`);
      output.appendLine(res.stderr || res.stdout);
      return { status: 'error', message: `Failed: ${inputFile}` };
    }

    const after = await fs.stat(outFile).then((st) => st.size).catch(() => 0);
    const reduction = calcReduction(before, after);
    return {
      status: 'ok',
      message: `${path.basename(inputFile)} → ${path.basename(outFile)}  (${humanBytes(before)} → ${humanBytes(after)} ${reduction})`
    };
  } finally {
    onCancel.dispose();
  }
}

async function expandTargets(uris: vscode.Uri[]): Promise<{ files: string[]; rootsForPreserve: Map<string, string | null> }> {
  const settings = getSettings();
  const files: string[] = [];
  const rootsForPreserve = new Map<string, string | null>();

  for (const uri of uris) {
    const p = uri.fsPath;
    const st = await fs.stat(p).catch(() => null);
    if (!st) continue;

    if (st.isDirectory()) {
      const dirFiles = await collectFilesFromDir(p, settings.recursive);
      for (const f of dirFiles) {
        files.push(f);
        rootsForPreserve.set(f, p);
      }
      continue;
    }

    if (st.isFile()) {
      if (isSupportedFile(p)) {
        files.push(p);
        rootsForPreserve.set(p, null);
      }
    }
  }

  // de-dupe
  const unique = Array.from(new Set(files));
  const newMap = new Map<string, string | null>();
  for (const f of unique) newMap.set(f, rootsForPreserve.get(f) ?? null);
  return { files: unique, rootsForPreserve: newMap };
}

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('AVIF Convertor');
  context.subscriptions.push(output);

  const disposable = vscode.commands.registerCommand(
    'avifConvert.convert',
    async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
      const targets = (uris && uris.length > 0 ? uris : uri ? [uri] : []).filter(Boolean) as vscode.Uri[];
      if (targets.length === 0) return;

      output.show(true);

      const ok = await ensureAvifEnc(output);
      if (!ok) return;

      let expanded: { files: string[]; rootsForPreserve: Map<string, string | null> };
      try {
        expanded = await expandTargets(targets);
      } catch (e) {
        vscode.window.showErrorMessage(`Failed to read selected targets: ${String(e)}`);
        return;
      }

      if (expanded.files.length === 0) {
        vscode.window.showInformationMessage('No supported images found (png/jpg/jpeg/gif/apng).');
        return;
      }

      // Get settings once at the start of conversion
      const settings = getSettings();

      const cpu = Math.max(1, os.cpus().length);
      const concurrency = Math.max(1, Math.min(cpu, 4)); // keep UI responsive; avifenc is already multi-threaded
      let idx = 0;
      let okCount = 0;
      let skipCount = 0;
      let errCount = 0;
      let cancelled = false;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Converting to AVIF (${expanded.files.length} file${expanded.files.length === 1 ? '' : 's'})`,
          cancellable: true
        },
        async (progress, token) => {
          const work = async () => {
            while (true) {
              if (token.isCancellationRequested) return;
              const myIndex = idx++;
              if (myIndex >= expanded.files.length) return;

              const f = expanded.files[myIndex];
              const root = expanded.rootsForPreserve.get(f) ?? null;
              progress.report({ message: `${myIndex + 1}/${expanded.files.length}: ${path.basename(f)}` });

              const result = await convertOne(f, settings, root, output, token);
              output.appendLine(result.message);
              if (result.status === 'ok') okCount++;
              else if (result.status === 'skipped') skipCount++;
              else if (result.status === 'cancelled') {
                cancelled = true;
                return; // Stop on cancel
              }
              else errCount++;
            }
          };

          const workers = Array.from({ length: Math.min(concurrency, expanded.files.length) }, () => work());
          await Promise.all(workers);
        }
      );

      if (cancelled) {
        vscode.window.showInformationMessage(`AVIF conversion cancelled. ${okCount} ok, ${skipCount} skipped before cancel.`);
      } else if (errCount > 0) {
        vscode.window.showWarningMessage(`AVIF conversion done: ${okCount} ok, ${skipCount} skipped, ${errCount} failed. See "AVIF Convertor" output.`);
      } else {
        vscode.window.showInformationMessage(`AVIF conversion done: ${okCount} ok, ${skipCount} skipped.`);
      }
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {}
