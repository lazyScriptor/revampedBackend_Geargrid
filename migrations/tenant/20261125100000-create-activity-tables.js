import { DataTypes } from "sequelize";
import { tableExists, addIndexIfMissing } from "../lib/schemaGuards.js";

const ACTIVITY_TYPES = [
  "invoice_created",
  "payment",
  "refund",
  "discount",
  "backdated_payment",
  "backdated_bill",
  "backdated_return",
  "return",
  "payment_voided",
  "invoice_deleted",
  "invoice_restored",
  "invoice_reopened",
  "id_card_released_unpaid",
  "review",
  "customer_payment",
  "call_promise_missed",
  "system",
];

export const up = async ({ context: qi }) => {
  if (!(await tableExists(qi, "ACTIVITY_EVENTS"))) {
    await qi.createTable("ACTIVITY_EVENTS", {
      event_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      type: {
        type: DataTypes.ENUM(...ACTIVITY_TYPES),
        allowNull: false,
      },
      risk: {
        type: DataTypes.ENUM("high", "normal"),
        allowNull: false,
        defaultValue: "normal",
      },
      invoice_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      customer_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      actor_user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
      },
      data: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      occurred_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      after_hours: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      checked_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      checked_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    });
  }

  await addIndexIfMissing(qi, "ACTIVITY_EVENTS", ["occurred_at"], {
    name: "idx_activity_events_occurred_at",
  });
  await addIndexIfMissing(qi, "ACTIVITY_EVENTS", ["type", "occurred_at"], {
    name: "idx_activity_events_type_occurred_at",
  });
  await addIndexIfMissing(qi, "ACTIVITY_EVENTS", ["invoice_id"], {
    name: "idx_activity_events_invoice_id",
  });
  await addIndexIfMissing(qi, "ACTIVITY_EVENTS", ["actor_user_id"], {
    name: "idx_activity_events_actor_user_id",
  });

  if (!(await tableExists(qi, "ACTIVITY_EVENT_COMMENTS"))) {
    await qi.createTable("ACTIVITY_EVENT_COMMENTS", {
      comment_id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      event_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      body: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    });
  }
  await addIndexIfMissing(qi, "ACTIVITY_EVENT_COMMENTS", ["event_id"], {
    name: "idx_activity_event_comments_event_id",
  });

  if (!(await tableExists(qi, "ACTIVITY_EVENT_READS"))) {
    await qi.createTable("ACTIVITY_EVENT_READS", {
      event_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
      },
      read_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    });
  }
};

export const down = async ({ context: qi }) => {
  if (await tableExists(qi, "ACTIVITY_EVENT_READS")) {
    await qi.dropTable("ACTIVITY_EVENT_READS");
  }
  if (await tableExists(qi, "ACTIVITY_EVENT_COMMENTS")) {
    await qi.dropTable("ACTIVITY_EVENT_COMMENTS");
  }
  if (await tableExists(qi, "ACTIVITY_EVENTS")) {
    await qi.dropTable("ACTIVITY_EVENTS");
  }
};
