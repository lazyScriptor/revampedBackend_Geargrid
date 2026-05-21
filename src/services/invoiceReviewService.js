import AppError from "../utils/AppError.js";

// Recompute Customer.rating as the rounded average of is_primary ratings.
// The aggregate is cheap on small data and avoids reads doing an aggregate
// join just to render a customer card. Called after every review write.
export const recomputeCustomerRating = async (models, customerId, transaction) => {
  if (!customerId) return null;
  const result = await models.InvoiceReview.findOne({
    attributes: [
      [
        models.sequelize.fn("AVG", models.sequelize.col("rating")),
        "avg_rating",
      ],
    ],
    where: {
      customer_id: customerId,
      is_primary: true,
      rating: { [models.sequelize.Sequelize.Op.not]: null },
    },
    raw: true,
    transaction,
  });

  const avg = parseFloat(result?.avg_rating);
  // Floor at 1 to mirror the existing 1..5 semantics on Customer.rating —
  // a customer with no ratings keeps their default 5 (no opinion); a customer
  // with 0 ratings via deletion drops back to 5 too.
  const next = Number.isFinite(avg) ? Math.max(1, Math.round(avg)) : 5;

  await models.Customer.update(
    { rating: next },
    { where: { customer_id: customerId }, transaction },
  );
  return next;
};

export const listForInvoice = async (models, invoiceId) => {
  return models.InvoiceReview.findAll({
    where: { invoice_id: invoiceId },
    include: [
      {
        model: models.User,
        as: "Author",
        attributes: ["user_id", "first_name", "last_name"],
      },
    ],
    order: [["createdAt", "DESC"]],
  });
};

export const create = async (models, invoiceId, payload, userId) => {
  const invoice = await models.Invoice.findByPk(invoiceId);
  if (!invoice) throw new AppError("Invoice not found.", 404);

  const data = {
    invoice_id: invoiceId,
    customer_id: invoice.customer_id,
    author_user_id: userId,
    stage: payload.stage || "return",
    rating: payload.rating ?? null,
    comment: payload.comment ?? null,
    is_primary: payload.is_primary !== false,
    visibility: payload.visibility || "internal",
  };

  if (data.rating !== null && (data.rating < 1 || data.rating > 5)) {
    throw new AppError("Rating must be between 1 and 5.", 400);
  }
  if (data.rating === null && !data.comment) {
    throw new AppError("Provide a rating, a comment, or both.", 400);
  }

  return await models.sequelize.transaction(async (t) => {
    // Demote sibling primaries so the customer-level average stays uniquely
    // anchored on this row. App-level guard since MySQL conditional unique
    // indexes aren't portable.
    if (data.is_primary) {
      await models.InvoiceReview.update(
        { is_primary: false },
        { where: { invoice_id: invoiceId, is_primary: true }, transaction: t },
      );
    }
    const created = await models.InvoiceReview.create(data, { transaction: t });
    await recomputeCustomerRating(models, data.customer_id, t);
    return created;
  });
};

export const update = async (models, reviewId, payload, userId) => {
  const review = await models.InvoiceReview.findByPk(reviewId);
  if (!review) throw new AppError("Review not found.", 404);
  if (review.author_user_id !== userId) {
    throw new AppError("You can only edit your own reviews.", 403);
  }

  const next = {
    stage: payload.stage ?? review.stage,
    rating: payload.rating !== undefined ? payload.rating : review.rating,
    comment: payload.comment !== undefined ? payload.comment : review.comment,
    is_primary:
      payload.is_primary !== undefined ? payload.is_primary : review.is_primary,
    visibility: payload.visibility ?? review.visibility,
  };

  if (next.rating !== null && (next.rating < 1 || next.rating > 5)) {
    throw new AppError("Rating must be between 1 and 5.", 400);
  }
  if (next.rating === null && !next.comment) {
    throw new AppError("Provide a rating, a comment, or both.", 400);
  }

  return await models.sequelize.transaction(async (t) => {
    if (next.is_primary && !review.is_primary) {
      await models.InvoiceReview.update(
        { is_primary: false },
        {
          where: {
            invoice_id: review.invoice_id,
            is_primary: true,
            review_id: { [models.sequelize.Sequelize.Op.ne]: review.review_id },
          },
          transaction: t,
        },
      );
    }
    await review.update(next, { transaction: t });
    await recomputeCustomerRating(models, review.customer_id, t);
    return review;
  });
};

export const remove = async (models, reviewId, userId) => {
  const review = await models.InvoiceReview.findByPk(reviewId);
  if (!review) throw new AppError("Review not found.", 404);
  if (review.author_user_id !== userId) {
    throw new AppError("You can only delete your own reviews.", 403);
  }
  const customerId = review.customer_id;
  return await models.sequelize.transaction(async (t) => {
    await review.destroy({ transaction: t });
    await recomputeCustomerRating(models, customerId, t);
    return true;
  });
};
