import { toaster } from "@decky/api";

const DURATION = 5000;
const GAP = 1500;

const queue: string[] = [];
let running = false;

// Show toasts one at a time so simultaneous reminders don't stack (PRD 3.4).
export function enqueueToast(title: string) {
  queue.push(title);
  if (!running) void run();
}

async function run() {
  running = true;
  while (queue.length) {
    // body is required by ToastData; empty = title only
    toaster.toast({ title: queue.shift()!, body: "", duration: DURATION });
    await new Promise((res) => setTimeout(res, DURATION + GAP));
  }
  running = false;
}
