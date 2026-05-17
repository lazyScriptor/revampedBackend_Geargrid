import { Op } from "sequelize";
import { getMasterModels } from "../models/master/index.js";
import AppError from "../utils/AppError.js";

const VALID_STATUS = ["new", "contacted", "qualified", "closed"];
const VALID_TYPES = ["demo", "sales", "support", "partnership", "other"];

// ─── Read ────────────────────────────────────────────────────────────────────
// List with pagination + filter + search. Server-paginates because the table
// is unbounded — a year of inquiries shouldn't tank the admin console.
export const listInquiries = async ({
  page = 1,
  pageSize = 25,
  status,
  inquiry_type,
  search,
  from_date,
  to_date,
} = {}) => {
  const { ContactInquiry } = getMasterModels();

  const where = {};
  if (status && VALID_STATUS.includes(status)) where.status = status;
  if (inquiry_type && VALID_TYPES.includes(inquiry_type))
    where.inquiry_type = inquiry_type;
  if (search && typeof search === "string" && search.trim()) {
    const q = `%${search.trim()}%`;
    where[Op.or] = [
      { name: { [Op.like]: q } },
      { email: { [Op.like]: q } },
      { company: { [Op.like]: q } },
      { message: { [Op.like]: q } },
    ];
  }
  if (from_date || to_date) {
    where.createdAt = {};
    if (from_date) where.createdAt[Op.gte] = new Date(from_date);
    if (to_date) where.createdAt[Op.lte] = new Date(to_date);
  }

  const safePage = Math.max(1, Number(page) || 1);
  const safeSize = Math.min(100, Math.max(1, Number(pageSize) || 25));
  const offset = (safePage - 1) * safeSize;

  const { rows, count } = await ContactInquiry.findAndCountAll({
    where,
    limit: safeSize,
    offset,
    order: [["createdAt", "DESC"]],
    // Don't return user_agent/referrer/IP in the list view — they bloat the
    // payload and are only useful in the detail view for spam triage.
    attributes: [
      "inquiry_id",
      "name",
      "email",
      "company",
      "inquiry_type",
      "status",
      "createdAt",
      "updatedAt",
    ],
  });

  return {
    rows,
    total: count,
    page: safePage,
    pageSize: safeSize,
    totalPages: Math.ceil(count / safeSize),
  };
};

// Aggregate counts for the badge in the nav + dashboard chips.
export const inquiryStats = async () => {
  const { ContactInquiry } = getMasterModels();
  const [byStatus, byType] = await Promise.all([
    ContactInquiry.findAll({
      attributes: [
        "status",
        [
          ContactInquiry.sequelize.fn(
            "COUNT",
            ContactInquiry.sequelize.col("inquiry_id"),
          ),
          "count",
        ],
      ],
      group: ["status"],
      raw: true,
    }),
    ContactInquiry.findAll({
      attributes: [
        "inquiry_type",
        [
          ContactInquiry.sequelize.fn(
            "COUNT",
            ContactInquiry.sequelize.col("inquiry_id"),
          ),
          "count",
        ],
      ],
      group: ["inquiry_type"],
      raw: true,
    }),
  ]);
  return {
    byStatus: byStatus.reduce((acc, r) => {
      acc[r.status] = Number(r.count);
      return acc;
    }, {}),
    byType: byType.reduce((acc, r) => {
      acc[r.inquiry_type] = Number(r.count);
      return acc;
    }, {}),
  };
};

export const getInquiry = async (id) => {
  const { ContactInquiry } = getMasterModels();
  const inquiry = await ContactInquiry.findByPk(id);
  if (!inquiry) throw new AppError("Inquiry not found.", 404);
  return inquiry;
};

// ─── Mutations ───────────────────────────────────────────────────────────────
// Status + notes are the only fields a super admin should be able to change.
// We never let them edit name/email/message — those are immutable evidence
// of what the user actually submitted.
export const updateInquiry = async (id, updates = {}) => {
  const { ContactInquiry } = getMasterModels();
  const inquiry = await ContactInquiry.findByPk(id);
  if (!inquiry) throw new AppError("Inquiry not found.", 404);

  const patch = {};
  if (updates.status !== undefined) {
    if (!VALID_STATUS.includes(updates.status)) {
      throw new AppError(
        `Invalid status. Must be one of: ${VALID_STATUS.join(", ")}.`,
        400,
      );
    }
    patch.status = updates.status;
  }
  if (updates.internal_notes !== undefined) {
    if (
      updates.internal_notes !== null &&
      (typeof updates.internal_notes !== "string" ||
        updates.internal_notes.length > 5000)
    ) {
      throw new AppError("Notes must be a string under 5000 characters.", 400);
    }
    patch.internal_notes = updates.internal_notes;
  }
  if (Object.keys(patch).length === 0) {
    throw new AppError("No valid fields to update.", 400);
  }

  await inquiry.update(patch);
  return inquiry;
};

export const deleteInquiry = async (id) => {
  const { ContactInquiry } = getMasterModels();
  const inquiry = await ContactInquiry.findByPk(id);
  if (!inquiry) throw new AppError("Inquiry not found.", 404);
  await inquiry.destroy();
  return { inquiry_id: Number(id) };
};
