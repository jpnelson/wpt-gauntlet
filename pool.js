export class Pool {
  constructor(size) {
    this.free = size;
    this.queue = [];
  }

  async whenFree(work) {
    const promise = new Promise((resolve) => {
      this.queue.push(async () => {
        const result = await work();
        resolve(result);
      });
    });
    this.tryWork();

    return promise;
  }

  tryWork() {
    if (this.queue.length === 0) {
      return;
    }
    const work = this.queue.shift();

    if (this.free > 0) {
      this.free--;
      work().then(() => {
        this.free++;
        this.tryWork();
      });
    } else {
      this.queue.unshift(work);
    }
  }
}
