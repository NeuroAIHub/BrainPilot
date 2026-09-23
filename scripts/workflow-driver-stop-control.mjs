/** Driver-only stop controls. No model/provider or product runtime dependency. */
import { lstat } from "node:fs/promises";

export function installDriverStopControl({ stopFile, onStop, onError = () => {} }) {
  let requested = false;
  let completion = Promise.resolve();
  let checking = false;
  const request = reason => {
    if (requested) return completion;
    requested = true;
    try { completion = Promise.resolve(onStop(reason)); }
    catch (error) { completion = Promise.reject(error); }
    completion.catch(onError);
    return completion;
  };
  // Keep these registered during asynchronous shutdown. A once listener is
  // removed before invocation; signal-exit can then re-send the same signal.
  const onSigint = () => { void request("operator_SIGINT"); };
  const onSigterm = () => { void request("operator_SIGTERM"); };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  const poll = async () => {
    if (requested || checking) return;
    checking = true;
    try {
      const info = await lstat(stopFile);
      const owner = typeof process.getuid === "function" ? process.getuid() : info.uid;
      if (info.isFile() && !info.isSymbolicLink() && (info.uid === owner || info.uid === 0)) {
        await request("operator_stop_file");
      }
    } catch (error) {
      if (error.code !== "ENOENT") onError(error);
    } finally { checking = false; }
  };
  const timer = setInterval(() => { void poll(); }, 1000);
  return {
    poll,
    settled: () => completion,
    /** Call only after report flush and runtime cleanup have finished. */
    dispose() {
      clearInterval(timer);
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
    },
  };
}
