export class ApplicationCommandError extends Error {
  constructor(
    public readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = "ApplicationCommandError";
  }
}

export function applicationErrorCode(error: unknown, fallback: string) {
  return error instanceof ApplicationCommandError ? error.code : fallback;
}
