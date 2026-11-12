import pg from 'pg';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function createPool(connectionString: string) {
  // В сети Amvera база внутренняя, SSL не нужен.
  return new pg.Pool({ connectionString, max: 10 });
}

export type Db = pg.Pool;
