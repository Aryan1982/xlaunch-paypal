/**
 * A counting semaphore with a FIFO queue. `acquire` resolves with a release
 * function once a slot is free; `onWait(ahead)` is told how many callers are
 * in front while it waits (0 when the slot is granted).
 */
export class Semaphore {
  private running = 0;
  private readonly queue: Array<{ grant: () => void; onWait?: (ahead: number) => void }> = [];

  constructor(private readonly slots: number) {}

  acquire(onWait?: (ahead: number) => void): Promise<() => void> {
    return new Promise((resolve) => {
      const grant = () => {
        this.running++;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.running--;
          this.next();
        });
      };
      if (this.running < this.slots && this.queue.length === 0) {
        grant();
        return;
      }
      this.queue.push({ grant, onWait });
      onWait?.(this.queue.length);
    });
  }

  private next(): void {
    if (this.running >= this.slots) return;
    const head = this.queue.shift();
    if (!head) return;
    head.onWait?.(0);
    head.grant();
    this.queue.forEach((w, i) => w.onWait?.(i + 1));
  }

  get waiting(): number {
    return this.queue.length;
  }
}
