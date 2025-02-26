
export interface WorkerTask {

  terminated: boolean;

  name: string;

  finished: Promise<void>;

  finish(): void;

  terminate(): void;

  ensureNotTerminated(): void;

}
