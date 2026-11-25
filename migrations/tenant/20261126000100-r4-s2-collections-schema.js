import { DataTypes, literal } from "sequelize";
import {
  addColumnIfMissing,
  addIndexIfMissing,
  repairZeroDates,
  tableExists,
} from "../lib/schemaGuards.js";

export const up = async ({ context: qi }) => {
  // 1. CALL_LOGS updates (manual calls + bill links)
  if (await tableExists(qi, "CALL_LOGS")) {
    const cols = await qi.describeTable("CALL_LOGS");
    if (cols.operator_device_id && cols.operator_device_id.allowNull === false) {
      await repairZeroDates(qi, "CALL_LOGS");
      await qi.changeColumn("CALL_LOGS", "operator_device_id", {
        type: DataTypes.INTEGER,
        allowNull: true,
      });
    }
    await addColumnIfMissing(qi, "CALL_LOGS", "source", {
      type: DataTypes.ENUM("phone", "manual"),
      allowNull: false,
      defaultValue: "phone",
    });
    await addColumnIfMissing(qi, "CALL_LOGS", "user_id", {
      type: DataTypes.INTEGER,
      allowNull: true,
    });
    await addColumnIfMissing(qi, "CALL_LOGS", "invoice_ids", {
      type: DataTypes.JSON,
      allowNull: true,
    });
    await addIndexIfMissing(qi, "CALL_LOGS", ["customer_id", "started_at"], {
      name: "idx_call_logs_customer_started",
    });
  }

  // 2. CALL_NOTES updates (outcomes, results, promises, bill links)
  if (await tableExists(qi, "CALL_NOTES")) {
    await addColumnIfMissing(qi, "CALL_NOTES", "outcome", {
      type: DataTypes.ENUM("answered", "no_answer", "unreachable"),
      allowNull: true,
    });
    await addColumnIfMissing(qi, "CALL_NOTES", "result", {
      type: DataTypes.STRING(64),
      allowNull: true,
    });
    await addColumnIfMissing(qi, "CALL_NOTES", "promise_amount", {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
    });
    await addColumnIfMissing(qi, "CALL_NOTES", "promise_date", {
      type: DataTypes.DATEONLY,
      allowNull: true,
    });
    await addColumnIfMissing(qi, "CALL_NOTES", "promise_kept_at", {
      type: DataTypes.DATE,
      allowNull: true,
    });
    await addColumnIfMissing(qi, "CALL_NOTES", "promise_status", {
      type: DataTypes.ENUM("waiting", "kept", "missed"),
      allowNull: true,
    });
    await addColumnIfMissing(qi, "CALL_NOTES", "invoice_ids", {
      type: DataTypes.JSON,
      allowNull: true,
    });
    await addIndexIfMissing(qi, "CALL_NOTES", ["promise_status", "promise_date"], {
      name: "idx_call_notes_promise_status_date",
    });
  }

  // 3. CALL_RECORDINGS table
  if (!(await tableExists(qi, "CALL_RECORDINGS"))) {
    await qi.createTable(
      "CALL_RECORDINGS",
      {
        recording_id: {
          type: DataTypes.INTEGER,
          autoIncrement: true,
          primaryKey: true,
          allowNull: false,
        },
        call_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        storage_key: {
          type: DataTypes.STRING(512),
          allowNull: false,
        },
        mime_type: {
          type: DataTypes.STRING(100),
          allowNull: false,
        },
        bytes: {
          type: DataTypes.BIGINT,
          allowNull: false,
        },
        duration_seconds: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        sha256: {
          type: DataTypes.STRING(64),
          allowNull: true,
        },
        uploaded_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: literal("CURRENT_TIMESTAMP"),
        },
        device_id: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        dispute_hold: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
      },
      { charset: "utf8mb4", collate: "utf8mb4_unicode_ci" },
    );
  }
  await addIndexIfMissing(qi, "CALL_RECORDINGS", ["call_id"], {
    unique: true,
    name: "uq_call_recordings_call_id",
  });
  await addIndexIfMissing(qi, "CALL_RECORDINGS", ["uploaded_at"], {
    name: "idx_call_recordings_uploaded_at",
  });

  // 4. CALL_RECORDING_LISTENS table
  if (!(await tableExists(qi, "CALL_RECORDING_LISTENS"))) {
    await qi.createTable(
      "CALL_RECORDING_LISTENS",
      {
        listen_id: {
          type: DataTypes.INTEGER,
          autoIncrement: true,
          primaryKey: true,
          allowNull: false,
        },
        recording_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        user_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        listened_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: literal("CURRENT_TIMESTAMP"),
        },
      },
      { charset: "utf8mb4", collate: "utf8mb4_unicode_ci" },
    );
  }
  await addIndexIfMissing(qi, "CALL_RECORDING_LISTENS", ["recording_id", "listened_at"], {
    name: "idx_call_recording_listens_rec_at",
  });

  // 5. Performance indexes for Collections report (spec 9.2.4)
  if (await tableExists(qi, "INVOICES")) {
    await addIndexIfMissing(qi, "INVOICES", ["customer_id", "status", "issued_date"], {
      name: "idx_invoices_customer_status_issued",
    });
  }
  if (await tableExists(qi, "INVOICE_LINES")) {
    await addIndexIfMissing(
      qi,
      "INVOICE_LINES",
      ["invoice_id", "line_status", "expected_return_date"],
      { name: "idx_invoice_lines_inv_status_due" },
    );
  }
};

export const down = async ({ context: qi }) => {
  if (await tableExists(qi, "CALL_RECORDING_LISTENS")) {
    await qi.dropTable("CALL_RECORDING_LISTENS");
  }
  if (await tableExists(qi, "CALL_RECORDINGS")) {
    await qi.dropTable("CALL_RECORDINGS");
  }
};
