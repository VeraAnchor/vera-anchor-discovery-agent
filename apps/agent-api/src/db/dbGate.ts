// apps/agent-api/src/db/dbGate.ts

let max = Number(process.env.AGENT_DB_CONCURRENCY || 8);
let active = 0;

const waiters: Array<() => void> = [];

export function setAgentDbConcurrency(n: number): void {
  if (!Number.isInteger(n) || n < 1 || n > 128) {
    throw new Error("AGENT_DB_CONCURRENCY must be an integer between 1 and 128");
  }

  max = n;
}

async function acquireAgentDbSlot(): Promise<void> {
  if (active < max) {
    active += 1;
    return;
  }

  await new Promise<void>((resolve) => {
    waiters.push(() => {
      active += 1;
      resolve();
    });
  });
}

function releaseAgentDbSlot(): void {
  active -= 1;

  if (active < 0) {
    active = 0;
    throw new Error("Agent DB gate active count went negative");
  }

  const next = waiters.shift();

  if (next) {
    next();
  }
}

export async function withAgentDbGate<T>(fn: () => Promise<T>): Promise<T> {
  await acquireAgentDbSlot();

  try {
    return await fn();
  } finally {
    releaseAgentDbSlot();
  }
}