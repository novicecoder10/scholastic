/** Shared across AI features (summaries, citations) that look a work up by workKey. */
export class WorkNotFoundError extends Error {
  constructor(workKey: string) {
    super(`No work found for workKey "${workKey}"`);
    this.name = "WorkNotFoundError";
  }
}
