/** The JSON contract written by the trusted trial setup and read by the isolated extension. */
export interface BoundaryConfig {
  browserConfigPath: string;
  processRegistryPath: string;
  snapshotReceiptDirectory: string;
  toolOutputDirectory: string;
  workspace: string;
  targetFile: string;
  piModule: string;
  profilePath: string;
  workerPath: string;
  nodeExecutable: string;
  playwrightExecutable: string;
  toolEnv: NodeJS.ProcessEnv;
  writableDirectories: string[];
  resourceDirectories: string[];
  resourceFiles: string[];
  commandTimeoutMs: number;
}

/** The subset of the dynamically loaded Pi API used by this boundary. */
export interface NativeResult {
  content: unknown[];
  details?: { truncation?: { truncated?: boolean }; [key: string]: unknown };
  isError?: boolean;
}

export type NativeUpdate = (result: NativeResult) => void;

type NativeTool<Params> = {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute(
    id: string,
    params: Params,
    signal?: AbortSignal,
    onUpdate?: NativeUpdate,
    context?: unknown,
  ): Promise<NativeResult>;
};

export interface FileParams {
  path: string;
  [key: string]: unknown;
}

export interface BashParams {
  command: string;
  [key: string]: unknown;
}

interface BashExecOptions {
  onData: (chunk: Buffer) => void;
  signal?: AbortSignal;
  timeout?: number;
  env?: NodeJS.ProcessEnv;
}

export interface NativePiModule {
  createReadTool(
    workspace: string,
    options: {
      operations: {
        readFile(path: string): Promise<Buffer>;
        access(path: string): Promise<void>;
      };
    },
  ): NativeTool<FileParams>;
  createEditTool(
    workspace: string,
    options: {
      operations: {
        readFile(path: string): Promise<Buffer>;
        access(path: string): Promise<void>;
        writeFile(path: string, content: string): Promise<void>;
      };
    },
  ): NativeTool<FileParams>;
  createWriteTool(
    workspace: string,
    options: {
      operations: {
        mkdir(path: string): Promise<void>;
        writeFile(path: string, content: string): Promise<void>;
      };
    },
  ): NativeTool<FileParams>;
  createBashTool(
    workspace: string,
    options?: {
      exposeSessionEnvironment?: boolean;
      operations: {
        exec(
          command: string,
          cwd: string,
          options: BashExecOptions,
        ): Promise<{ exitCode: number | null }>;
      };
    },
  ): NativeTool<BashParams>;
}

export interface PiExtension {
  registerTool<Params>(tool: NativeTool<Params>): void;
  registerCommand(
    name: string,
    command: { description: string; handler: () => Promise<void> },
  ): void;
  on(event: 'session_start', handler: () => Promise<void>): void;
  setActiveTools(names: string[]): void;
}
