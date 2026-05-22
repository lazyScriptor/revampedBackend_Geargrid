import fs from "fs";
import path from "path";

// All bulk-job working files live under uploads/jobs/<tenant>/<jobId>/
// - input:  the file the user uploaded (CSV/Excel)
// - output: the generated artifact (CSV/Excel/PDF/ZIP)
//
// This keeps tenants isolated and makes cleanup trivial (rm -rf tenantDir).

const ROOT = path.resolve(process.cwd(), "uploads", "jobs");

const sanitizeSegment = (s) => String(s).replace(/[^a-zA-Z0-9_.-]/g, "_");

export const ensureJobDir = (tenantDbName, jobId) => {
  const dir = path.join(ROOT, sanitizeSegment(tenantDbName), String(jobId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

export const saveInputFile = (tenantDbName, jobId, originalName, buffer) => {
  const dir = ensureJobDir(tenantDbName, jobId);
  const safeName = `input_${sanitizeSegment(originalName)}`;
  const filePath = path.join(dir, safeName);
  fs.writeFileSync(filePath, buffer);
  return filePath;
};

export const saveOutputFile = (tenantDbName, jobId, fileName, bufferOrStream) => {
  const dir = ensureJobDir(tenantDbName, jobId);
  const safeName = `output_${sanitizeSegment(fileName)}`;
  const filePath = path.join(dir, safeName);

  if (Buffer.isBuffer(bufferOrStream)) {
    fs.writeFileSync(filePath, bufferOrStream);
    return filePath;
  }
  // Streamable
  return new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(filePath);
    bufferOrStream.pipe(ws);
    ws.on("finish", () => resolve(filePath));
    ws.on("error", reject);
  });
};

export const readFileBuffer = (filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath);
};

export const fileExists = (filePath) => Boolean(filePath && fs.existsSync(filePath));

export const fileSize = (filePath) => {
  if (!fileExists(filePath)) return 0;
  return fs.statSync(filePath).size;
};

export const deleteJobFiles = (tenantDbName, jobId) => {
  const dir = path.join(ROOT, sanitizeSegment(tenantDbName), String(jobId));
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

export const streamFile = (filePath) => {
  if (!fileExists(filePath)) return null;
  return fs.createReadStream(filePath);
};
