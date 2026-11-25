import fs from "node:fs/promises";
import path from "node:path";

/**
 * One JSON file per idea folder: { sessionId, messages: [{ role, text, tools?, at, error? }] }.
 * Kept next to the app (git-ignored), so chats stay on this PC and out of the ideas' history.
 */
export function chatStore(dir) {
  const file = (folder) => {
    if (!/^[\w.-]+$/.test(folder)) throw new Error("Bad folder name");
    return path.join(dir, `${folder}.json`);
  };
  return {
    async get(folder) {
      try {
        return JSON.parse(await fs.readFile(file(folder), "utf8"));
      } catch {
        return { sessionId: null, messages: [] };
      }
    },
    async append(folder, messages, sessionId) {
      await fs.mkdir(dir, { recursive: true });
      const chat = await this.get(folder);
      chat.messages.push(...messages);
      if (sessionId) chat.sessionId = sessionId;
      await fs.writeFile(file(folder), JSON.stringify(chat, null, 2), "utf8");
      return chat;
    },
    async remove(folder) {
      await fs.rm(file(folder), { force: true });
    },
    async has(folder) {
      return fs
        .access(file(folder))
        .then(() => true)
        .catch(() => false);
    },
  };
}
