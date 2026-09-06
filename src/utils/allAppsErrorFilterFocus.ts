// One-shot signal: open All Apps already filtered to "Erreur".
let requested = false;

export function requestErrorFilterOnOpen(): void {
  requested = true;
}

export function consumeErrorFilterRequest(): boolean {
  const value = requested;
  requested = false;
  return value;
}
