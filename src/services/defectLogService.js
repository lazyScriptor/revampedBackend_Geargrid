import { Op } from "sequelize";
import AppError from "../utils/AppError.js";

// --- 1. CREATE DEFECT (From POS Return) ---
export const createDefectLog = async (models, data) => {
  const t = await models.sequelize.transaction();
  try {
    const equipment = await models.Equipment.findByPk(data.equipment_id, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!equipment) throw new AppError("Equipment not found.", 404);

    const log = await models.DefectLog.create(
      {
        ...data,
        pending_quantity: data.defective_quantity, // Initializes pending to the total amount broken
        repaired_quantity: 0,
        repair_status: "Pending Assignment",
        reported_date: new Date(),
      },
      { transaction: t },
    );

    // Note: Inventory deduction is already handled by the invoiceService during returns!
    await t.commit();
    return log;
  } catch (error) {
    await t.rollback();
    throw error;
  }
};

// --- 2. GET ALL DEFECTS (For Dashboard) ---
export const getAllDefectLogs = async (models, queryParams) => {
  const page = parseInt(queryParams.page) || 1;
  const limit = parseInt(queryParams.limit) || 20;
  const offset = (page - 1) * limit;

  const whereClause = {};
  if (queryParams.status) whereClause.repair_status = queryParams.status;

  const { count, rows } = await models.DefectLog.findAndCountAll({
    where: whereClause,
    limit,
    offset,
    order: [["reported_date", "DESC"]],
    include: [
      {
        model: models.Equipment,
        attributes: ["equipment_name", "serial_number"],
      },
      {
        model: models.User,
        as: "Technician",
        attributes: ["first_name", "last_name", "email"],
      }, // Pulls the assigned tech's name
    ],
  });

  return { totalItems: count, logs: rows };
};

// --- 3. ASSIGN TECHNICIAN ---
// --- 3. ASSIGN TECHNICIAN (Bulletproof) ---
export const assignTechnician = async (models, logId, technicianId) => {
  const log = await models.DefectLog.findByPk(logId);
  if (!log) throw new AppError("Defect log not found.", 404);

  // Assign the user
  log.assigned_technician_id = technicianId;

  // Catch BOTH the new enterprise status AND the old legacy status!
  if (
    log.repair_status === "Pending Assignment" ||
    log.repair_status === "Reported" ||
    log.repair_status === "Pending"
  ) {
    log.repair_status = "In Repair";
  }

  await log.save();
  return log;
};

// --- 4. PARTIAL / FULL RESOLUTION ENGINE ---
export const resolveDefectLog = async (models, logId, resolvedQtyParam) => {
  const t = await models.sequelize.transaction();
  try {
    const log = await models.DefectLog.findByPk(logId, { transaction: t });
    if (!log) throw new AppError("Defect log not found.", 404);
    if (log.repair_status === "Resolved")
      throw new AppError("This defect is already fully resolved.", 400);

    const qtyToResolve = parseInt(resolvedQtyParam);
    if (qtyToResolve <= 0 || qtyToResolve > log.pending_quantity) {
      throw new AppError(
        `Invalid quantity. You can resolve between 1 and ${log.pending_quantity} items.`,
        400,
      );
    }

    // 1. Update the Log Math
    log.repaired_quantity += qtyToResolve;
    log.pending_quantity -= qtyToResolve;

    // 2. Determine New Status
    if (log.pending_quantity === 0) {
      log.repair_status = "Resolved";
      log.resolved_date = new Date();
    } else {
      log.repair_status = "Partially Resolved"; // Still has items in the shop
    }
    await log.save({ transaction: t });

    // 3. Return Inventory to Shelf (WITH ROW LOCK)
    const equipment = await models.Equipment.findByPk(log.equipment_id, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    await equipment.update(
      {
        defective_qty: equipment.defective_qty - qtyToResolve,
        available_qty: equipment.available_qty + qtyToResolve,
      },
      { transaction: t },
    );

    await t.commit();
    return log;
  } catch (error) {
    await t.rollback();
    throw error;
  }
};
