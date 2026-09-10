export function workerConcurrency(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 32) {
    throw new Error(`${name} must be an integer between 1 and 32`);
  }
  return value;
}
