/** Stable boundaries for first-party adapters. These contracts are gradually applied to JS adapters. */
export type Edition = 'java' | 'bedrock';
export type Loader = 'fabric' | 'forge' | 'neoforge' | 'bedrock';
export interface GameTarget {
  edition: Edition;
  loader: Loader;
  minecraft: string;
  java: number;
}
export interface TargetDescriptor {
  id: string;
  label: string;
  target: Readonly<GameTarget>;
  artifact: 'jar' | 'mcaddon';
  validation: 'compiled' | 'package-checked' | 'unverified';
  enabled: boolean;
  features: readonly string[];
}
export interface FileEntry {
  path: string;
  size: number;
  sha256: string;
  encoding: 'base64';
  content: string;
}
export interface EngineeringSnapshot {
  hash: string;
  specHash: string;
  modId: string;
  displayName: string;
  targetId: string;
  template: Readonly<Record<string, unknown>>;
  files: FileEntry[];
  assetIds: string[];
}
export interface GenerationAdapter<Spec, Asset> {
  targetId: string;
  generate(spec: Spec, assets: readonly Asset[]): EngineeringSnapshot;
}
export type RunState =
  'queued' | 'running' | 'passed' | 'failed' | 'cancelled' | 'timed_out' | 'interrupted';
export interface ProviderContext {
  signal?: AbortSignal;
}
export interface ModelSource {
  provider: string;
  model?: string;
  demo: boolean;
  usage?: { inputTokens: number | null; outputTokens: number | null };
}
export interface SpecProvider<Project, Spec> {
  planSpec(
    project: Project,
    context?: ProviderContext,
  ): Promise<{ spec: Spec; source: ModelSource }>;
}
export interface AssetProvider<Request, Data> {
  planAsset(
    request: Request,
    context?: ProviderContext,
  ): Promise<{ kind: string; data: Data; source: ModelSource }>;
}
export interface Repository<T> {
  get(id: string): T;
  list(): T[];
  save(record: T): T;
}
