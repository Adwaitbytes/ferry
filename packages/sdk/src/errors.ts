/** Every failure the SDK surfaces. `code` is stable; `status` is the Gate's HTTP status if any. */
export class FerryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'FerryError';
  }
}
