import fs from "fs";
import path from "path";
import AppError from "../../utils/AppError.js";

const DEFAULT_LOCAL_DIR = path.resolve(process.cwd(), "..", "geargrid-call-recordings");

export const createLocalStorageDriver = ({
  baseDir = process.env.CALL_RECORDINGS_LOCAL_DIR ||
    process.env.RECORDINGS_LOCAL_DIR ||
    DEFAULT_LOCAL_DIR,
} = {}) => {
  const resolvedBase = path.resolve(baseDir);

  const resolveSafePath = (key) => {
    const cleanKey = String(key || "").replace(/^\/+/, "");
    const target = path.resolve(resolvedBase, cleanKey);
    if (!target.startsWith(resolvedBase + path.sep) && target !== resolvedBase) {
      throw new AppError("Invalid storage key.", 400);
    }
    return target;
  };

  return {
    driver: "local",
    baseDir: resolvedBase,

    async putObject({ key, buffer }) {
      const target = resolveSafePath(key);
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.writeFile(target, buffer);
      return { key, bytes: buffer.length };
    },

    async getReadStream({ key }) {
      const target = resolveSafePath(key);
      if (!fs.existsSync(target)) {
        throw new AppError("Recording file not found.", 404);
      }
      return fs.createReadStream(target);
    },

    async getSignedUrl() {
      return null;
    },

    async deleteObject({ key }) {
      const target = resolveSafePath(key);
      if (fs.existsSync(target)) {
        await fs.promises.unlink(target);
        return true;
      }
      return false;
    },
  };
};
