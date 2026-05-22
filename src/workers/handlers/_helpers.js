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

// Streaming CSV parse with progress callbacks. We stream so 50 MB files don't
// blow heap. `onBatch(rows)` is called every `batchSize` rows.
export const streamParseCsv = async (filePath, { batchSize = 500, onBatch }) => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Input file missing: ${filePath}`);
  }
  return new Promise((resolve, reject) => {
    let buffer = [];
    let total = 0;

    Papa.parse(fs.createReadStream(filePath), {
      header: true,
      skipEmptyLines: true,
      step: async (results, parser) => {
        buffer.push(results.data);
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

export const countCsvRows = (filePath) => {
  // Lightweight count (excluding header) — used to pre-fill total_count for
  // a smoother progress bar. We scan the file once with a streaming reader.
  return new Promise((resolve, reject) => {
    let count = 0;
    let isFirst = true;
    Papa.parse(fs.createReadStream(filePath), {
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
