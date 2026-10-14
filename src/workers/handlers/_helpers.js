import ExcelJS from "exceljs";
import { Parser as Json2CsvParser } from "json2csv";
import Papa from "papaparse";
import fs from "fs";
import { saveOutputFile } from "../../utils/jobFileStore.js";

const sanitize = (v) => {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return v;
};

export const writeRowsToExcel = async ({
  tenantDbName,
  jobId,
  sheetName,
  headers, // [{ key, label, width? }]
  rows,    // plain objects keyed by header.key
  fileName,
}) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName || "Sheet1");
  ws.columns = headers.map((h) => ({
    header: h.label,
    key: h.key,
    width: h.width || 18,
  }));
  for (const row of rows) {
    const norm = {};
    for (const h of headers) norm[h.key] = sanitize(row[h.key]);
    ws.addRow(norm);
  }
  ws.getRow(1).font = { bold: true };
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return saveOutputFile(tenantDbName, jobId, fileName, buffer);
};

export const writeRowsToCsv = ({
  tenantDbName,
  jobId,
  headers, // [{ key, label }]
  rows,
  fileName,
}) => {
  const parser = new Json2CsvParser({
    fields: headers.map((h) => ({ label: h.label, value: h.key })),
  });
  const csv = parser.parse(rows.map((r) => {
    const out = {};
    for (const h of headers) out[h.key] = sanitize(r[h.key]);
    return out;
  }));
  return saveOutputFile(tenantDbName, jobId, fileName, Buffer.from(csv, "utf8"));
};

import readline from "readline";
import { Transform } from "stream";

// Helper: detect if every line in a CSV is wrapped in quotes like "col1,col2,col3"
const isWholeLineQuoted = async (filePath) => {
  try {
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        rl.close();
        return (
          trimmed.startsWith('"') &&
          trimmed.endsWith('"') &&
          trimmed.includes(",")
        );
      }
    }
  } catch {
    return false;
  }
  return false;
};

// Create stream that strips outer quotes and unescapes doubled quotes if wrapped
const createNormalizedCsvStream = (filePath, isQuoted) => {
  if (!isQuoted) return fs.createReadStream(filePath);

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });

  const transform = new Transform({
    transform(chunk, encoding, callback) {
      callback(null, chunk);
    },
  });

  rl.on("line", (line) => {
    let l = line.trim();
    if (l.startsWith('"') && l.endsWith('"')) {
      l = l.slice(1, -1).replace(/""/g, '"');
    }
    transform.write(l + "\n");
  });

  rl.on("close", () => {
    transform.end();
  });

  rl.on("error", (err) => {
    transform.destroy(err);
  });

  return transform;
};

// Streaming CSV parse with progress callbacks. We stream so 50 MB files don't
// blow heap. `onBatch(rows)` is called every `batchSize` rows.
export const streamParseCsv = async (filePath, { batchSize = 500, onBatch }) => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Input file missing: ${filePath}`);
  }

  const isQuoted = await isWholeLineQuoted(filePath);

  return new Promise((resolve, reject) => {
    let buffer = [];
    let total = 0;

    const stream = createNormalizedCsvStream(filePath, isQuoted);

    Papa.parse(stream, {
      header: true,
      skipEmptyLines: true,
      step: async (results, parser) => {
        let rowData = results.data;

        // Fallback: if row parsed into a single key with commas
        if (rowData && typeof rowData === "object") {
          const keys = Object.keys(rowData);
          if (keys.length === 1 && keys[0].includes(",")) {
            const re = Papa.parse(`${keys[0]}\n${rowData[keys[0]]}`, {
              header: true,
            });
            if (re.data && re.data[0]) {
              rowData = re.data[0];
            }
          }
        }

        buffer.push(rowData);
        if (buffer.length >= batchSize) {
          parser.pause();
          try {
            await onBatch(buffer);
            total += buffer.length;
            buffer = [];
            parser.resume();
          } catch (err) {
            parser.abort();
            reject(err);
          }
        }
      },
      complete: async () => {
        try {
          if (buffer.length > 0) {
            await onBatch(buffer);
            total += buffer.length;
            buffer = [];
          }
          resolve({ totalRows: total });
        } catch (err) {
          reject(err);
        }
      },
      error: reject,
    });
  });
};

export const countCsvRows = async (filePath) => {
  // Lightweight count (excluding header) — used to pre-fill total_count for
  // a smoother progress bar. We scan the file once with a streaming reader.
  const isQuoted = await isWholeLineQuoted(filePath);
  return new Promise((resolve, reject) => {
    let count = 0;
    let isFirst = true;
    const stream = createNormalizedCsvStream(filePath, isQuoted);
    Papa.parse(stream, {
      header: false,
      skipEmptyLines: true,
      step: () => {
        if (isFirst) {
          isFirst = false; // skip header row
          return;
        }
        count += 1;
      },
      complete: () => resolve(count),
      error: reject,
    });
  });
};

