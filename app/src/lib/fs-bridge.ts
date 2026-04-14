import { invoke } from "@tauri-apps/api/core";
import type { Socket } from "socket.io-client";
import { getApiKey } from "./api";

export function initFsBridge(socket: Socket) {
  socket.on(
    "fs:command",
    async (
      data: { command: string; args: Record<string, unknown> },
      callback: (result: {
        ok: boolean;
        data?: unknown;
        error?: string;
      }) => void
    ) => {
      try {
        const commandMap: Record<string, string> = {
          list_files: "fs_list_dir",
          read_file: "fs_read_text_file",
          read_binary_file: "fs_read_binary_file",
          write_file: "fs_write_text_file",
          move_file: "fs_move_file",
          copy_file: "fs_copy_file",
          delete_file: "fs_delete_file",
          create_directory: "fs_create_dir",
        };

        const tauriCommand = commandMap[data.command];
        if (!tauriCommand) {
          callback({ ok: false, error: `Unknown command: ${data.command}` });
          return;
        }

        const result = await invoke(tauriCommand, data.args);
        callback({ ok: true, data: result });
      } catch (err) {
        callback({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  );
}

export async function getWorkingDir(): Promise<string | null> {
  try {
    return await invoke<string | null>("get_working_directory");
  } catch {
    return null;
  }
}

export async function setWorkingDir(path: string): Promise<void> {
  await invoke("set_working_directory", { path });

  // Sync working directory to server (fire-and-forget)
  try {
    const key = getApiKey();
    if (key) {
      fetch("http://localhost:4000/api/settings/working-directory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
        body: JSON.stringify({ workingDirectory: path }),
      }).catch(() => {});
    }
  } catch {}
}
