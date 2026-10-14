import { Op } from "sequelize";
import AppError from "../utils/AppError.js";

export const createEquipment = async (models, data) => {
  // 1. Force strict defaults for fresh equipment
  const totalOwned = parseInt(data.total_owned_qty) || 1;

  const safeData = {
    ...data,
    total_owned_qty: totalOwned,
    rented_qty: 0, // Always 0 on creation
    defective_qty: 0, // Always 0 on creation
    available_qty: totalOwned, // Available strictly equals Total
  };

  return await models.Equipment.create(safeData);
};

export const updateEquipment = async (models, id, data) => {
  const equipment = await models.Equipment.findByPk(id);
  if (!equipment) throw new AppError("Equipment not found.", 404);

  // 1. Strip out fields that should NEVER be edited from this form
  // (These are strictly managed by the POS Invoice system and Maintenance Defect Logs)
  delete data.rented_qty;
  delete data.defective_qty;
  delete data.available_qty;

  // 2. If they are changing the Total Owned Qty, safely recalculate Available Qty
  if (data.total_owned_qty !== undefined) {
    const newTotal = parseInt(data.total_owned_qty);

    // Safety check: You can't say you own 5 drills if 6 are currently rented out!
    if (newTotal < equipment.rented_qty + equipment.defective_qty) {
      throw new AppError(
        `Cannot lower total to ${newTotal}. There are already ${equipment.rented_qty} rented and ${equipment.defective_qty} defective.`,
        400,
      );
    }

    data.total_owned_qty = newTotal;
    // Strictly enforce the golden formula
    data.available_qty =
      newTotal - equipment.rented_qty - equipment.defective_qty;
  }

  await equipment.update(data);
  return equipment;
};

export const getAllEquipment = async (models, queryParams) => {
  // 1. Setup Pagination (Defaults to page 1, 20 items per page)
  const page = parseInt(queryParams.page) || 1;
  const limit = parseInt(queryParams.limit) || 20;
  const offset = (page - 1) * limit;

  // 2. Setup Dynamic Filtering
  const whereClause = {};

  if (queryParams.status) whereClause.status = queryParams.status;
  if (queryParams.category_id)
    whereClause.category_id = queryParams.category_id;
  if (queryParams.warehouse_id)
    whereClause.warehouse_id = queryParams.warehouse_id;

  if (queryParams.availability === "in_stock") {
    whereClause.available_qty = { [Op.gt]: 0 };
  } else if (queryParams.availability === "rented") {
    whereClause.rented_qty = { [Op.gt]: 0 };
  } else if (queryParams.availability === "in_repair") {
    whereClause.defective_qty = { [Op.gt]: 0 };
  }

  // 3. Setup Searching (Search by name OR serial number)
  if (queryParams.search) {
    whereClause[Op.or] = [
      { equipment_name: { [Op.like]: `%${queryParams.search}%` } },
      { serial_number: { [Op.like]: `%${queryParams.search}%` } },
    ];
  }

  // 4. Execute the Query with 'findAndCountAll' for pagination metadata
  const { count, rows } = await models.Equipment.findAndCountAll({
    where: whereClause,
    limit,
    offset,
    order: [["createdAt", "DESC"]], // Newest first
    include: [
      { model: models.EquipmentCategory, attributes: ["category_name"] },
      { model: models.Warehouse, attributes: ["location_name"] },
    ],
  });

  return {
    total: count,
    totalItems: count,
    totalPages: Math.ceil(count / limit),
    currentPage: page,
    equipment: rows,
  };
};

export const getEquipmentById = async (models, equipmentId) => {
  const equipment = await models.Equipment.findByPk(equipmentId, {
    include: [
      {
        model: models.EquipmentCategory,
        attributes: ["category_id", "category_name"],
      },
      {
        model: models.Warehouse,
        attributes: ["warehouse_id", "location_name"],
      },
    ],
  });

  if (!equipment) throw new AppError("Equipment not found.", 404);
  return equipment;
};

export const updateEquipmentStatus = async (models, equipmentId, newStatus) => {
  const validStatuses = ["Available", "Rented", "Maintenance", "Retired"];
  if (!validStatuses.includes(newStatus)) {
    throw new AppError(
      `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
      400,
    );
  }

  const equipment = await getEquipmentById(models, equipmentId);
  equipment.status = newStatus;
  await equipment.save();
  return equipment;
};

export const deleteEquipment = async (models, id) => {
  const equipment = await models.Equipment.findByPk(id);

  if (!equipment) {
    const error = new Error("Equipment not found.");
    error.statusCode = 404;
    throw error;
  }

  await equipment.destroy();
  return true;
};

export const bulkUpdateEquipment = async (models, payload) => {
  const { ids, updates } = payload;
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new AppError("No equipment IDs provided for bulk update.", 400);
  }

  if (!updates || Object.keys(updates).length === 0) {
    throw new AppError("No update fields provided.", 400);
  }

  return await models.sequelize.transaction(async (t) => {
    const items = await models.Equipment.findAll({
      where: { equipment_id: { [Op.in]: ids } },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (items.length === 0) {
      throw new AppError("No matching equipment records found.", 404);
    }

    const {
      category_id,
      warehouse_id,
      is_bulk_item,
      base_rental_price,
      minimum_rental_days,
      extra_daily_rate,
      price_adjustment,
    } = updates;

    // Validate category if updating
    if (category_id !== undefined && category_id !== null && category_id !== "") {
      const category = await models.EquipmentCategory.findByPk(category_id, { transaction: t });
      if (!category) throw new AppError(`Category ID ${category_id} does not exist.`, 400);
    }

    // Validate warehouse if updating
    if (warehouse_id !== undefined && warehouse_id !== null && warehouse_id !== "") {
      const warehouse = await models.Warehouse.findByPk(warehouse_id, { transaction: t });
      if (!warehouse) throw new AppError(`Warehouse ID ${warehouse_id} does not exist.`, 400);
    }

    const updatedIds = [];

    for (const item of items) {
      const itemPatch = {};

      if (category_id !== undefined && category_id !== "") itemPatch.category_id = Number(category_id);
      if (warehouse_id !== undefined && warehouse_id !== "") itemPatch.warehouse_id = Number(warehouse_id);
      if (is_bulk_item !== undefined) itemPatch.is_bulk_item = Boolean(is_bulk_item);
      if (minimum_rental_days !== undefined && minimum_rental_days !== "") {
        const minDays = parseInt(minimum_rental_days, 10);
        if (minDays > 0) itemPatch.minimum_rental_days = minDays;
      }
      if (base_rental_price !== undefined && base_rental_price !== "") {
        const base = parseFloat(base_rental_price);
        if (!isNaN(base) && base >= 0) itemPatch.base_rental_price = base;
      }
      if (extra_daily_rate !== undefined && extra_daily_rate !== "") {
        const extra = parseFloat(extra_daily_rate);
        if (!isNaN(extra) && extra >= 0) itemPatch.extra_daily_rate = extra;
      }

      // Percentage or fixed price adjustment delta across selected equipment
      if (price_adjustment && typeof price_adjustment.value === "number") {
        const { type, field = "both", value } = price_adjustment;
        const currentBase = parseFloat(item.base_rental_price) || 0;
        const currentExtra = parseFloat(item.extra_daily_rate) || 0;

        if (type === "percentage") {
          const factor = 1 + value / 100;
          if (field === "both" || field === "base") {
            itemPatch.base_rental_price = Math.max(0, Math.round(currentBase * factor * 100) / 100);
          }
          if (field === "both" || field === "extra") {
            itemPatch.extra_daily_rate = Math.max(0, Math.round(currentExtra * factor * 100) / 100);
          }
        } else if (type === "fixed") {
          if (field === "both" || field === "base") {
            itemPatch.base_rental_price = Math.max(0, currentBase + value);
          }
          if (field === "both" || field === "extra") {
            itemPatch.extra_daily_rate = Math.max(0, currentExtra + value);
          }
        }
      }

      if (Object.keys(itemPatch).length > 0) {
        await item.update(itemPatch, { transaction: t });
        updatedIds.push(item.equipment_id);
      }
    }

    return {
      updatedCount: updatedIds.length,
      ids: updatedIds,
    };
  });
};
