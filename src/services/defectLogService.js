import { Op } from "sequelize";
import AppError from "../utils/AppError.js";

export const createDefectLog = async (models, data) => {
  const t = await models.sequelize.transaction();
  try {
    const equipment = await models.Equipment.findByPk(data.equipment_id, {
      transaction: t,
    });
    if (!equipment) throw new AppError("Equipment not found.", 404);

    if (equipment.available_qty < data.defective_quantity) {
      throw new AppError(
        `Cannot mark ${data.defective_quantity} as defective. Only ${equipment.available_qty} available in inventory.`,
        400,
      );
    }

    // 1. Create the log
    const log = await models.DefectLog.create(
      {
        ...data,
        reported_date: new Date(),
        repair_status: "Reported",
      },
      { transaction: t },
    );

    // 2. Adjust Equipment Inventory
    equipment.available_qty -= data.defective_quantity;
    equipment.defective_qty += data.defective_quantity;
    await equipment.save({ transaction: t });

    await t.commit();
    return log;
  } catch (error) {
    await t.rollback();
    throw error;
  }
};

export const getAllDefectLogs = async (models, queryParams) => {
  const page = parseInt(queryParams.page) || 1;
  const limit = parseInt(queryParams.limit) || 20;
  const offset = (page - 1) * limit;

  const whereClause = {};
  if (queryParams.status) whereClause.repair_status = queryParams.status; // e.g., 'Reported', 'In Repair', 'Resolved'

  if (queryParams.search) {
    whereClause.defect_description = { [Op.like]: `%${queryParams.search}%` };
  }

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
    ],
  });

  return {
    totalItems: count,
    totalPages: Math.ceil(count / limit),
    currentPage: page,
    logs: rows,
  };
};

export const resolveDefectLog = async (models, logId) => {
  const t = await models.sequelize.transaction();
  try {
    const log = await models.DefectLog.findByPk(logId, { transaction: t });
    if (!log) throw new AppError("Defect log not found.", 404);
    if (log.repair_status === "Resolved")
      throw new AppError("This defect is already resolved.", 400);

    // 1. Update log status
    log.repair_status = "Resolved";
    log.resolved_date = new Date();
    await log.save({ transaction: t });

    // 2. Return inventory back to available
    const equipment = await models.Equipment.findByPk(log.equipment_id, {
      transaction: t,
    });
    equipment.defective_qty -= log.defective_quantity;
    equipment.available_qty += log.defective_quantity;
    await equipment.save({ transaction: t });

    await t.commit();
    return log;
  } catch (error) {
    await t.rollback();
    throw error;
  }
};
