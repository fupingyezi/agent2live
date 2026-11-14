export interface Clock {
  now(): number
}

export const systemClock: Clock = { now: () => Date.now() }

export class FakeClock implements Clock {
  constructor(private value: number) {}

  now(): number {
    return this.value
  }

  set(value: number): void {
    this.value = value
  }

  advance(ms: number): void {
    this.value += ms
  }
}
