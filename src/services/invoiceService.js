import AppError from "../utils/AppError.js";

export const createDispatchInvoice = async (models, payload, userId) => {
  const { customer_id, items, fees } = payload;

  // Start a Managed SQL Transaction
  return await models.sequelize.transaction(async (t) => {
    // 1. Calculate Backend Totals (Never trust the frontend's total!)
    let subTotal = 0;

    // We map the incoming items to InvoiceLine format while calculating math
    const invoiceLinesData = items.map((item) => {
      const start = new Date(item.borrow_date).getTime();
      const end = new Date(item.expected_return_date).getTime();
      let totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
      if (totalDays < 1 || isNaN(totalDays)) totalDays = 1;

      let lineTotal = 0;
      if (totalDays <= item.locked_minimum_days) {
        lineTotal = item.locked_base_price * item.borrow_quantity;
      } else {
        const extraDays = totalDays - item.locked_minimum_days;
        lineTotal =
          (item.locked_base_price + extraDays * item.locked_extra_daily_rate) *
          item.borrow_quantity;
      }

      subTotal += lineTotal;

      return {
        equipment_id: item.equipment_id,
        borrow_date: item.borrow_date,
        expected_return_date: item.expected_return_date,
        locked_base_price: item.locked_base_price,
        locked_minimum_days: item.locked_minimum_days,
        locked_extra_daily_rate: item.locked_extra_daily_rate,
        borrow_quantity: item.borrow_quantity,
        line_total_amount: lineTotal,
        line_status: "Active",
      };
    });

    const grandTotal = Math.max(
      0,
      subTotal + (fees.transport || 0) - (fees.discount || 0),
    );

    // 2. Create the Master Invoice
    const newInvoice = await models.Invoice.create(
      {
        customer_id,
        issued_by_user_id: userId,
        total_amount: grandTotal,
        advance_paid: fees.advance || 0,
        transport_fee: fees.transport || 0,
        discount_amount: fees.discount || 0,
        sub_total: subTotal,
        number_of_days_of_the_bill: Math.max(
          ...items.map((i) => {
            const days = Math.ceil(
              (new Date(i.expected_return_date).getTime() -
                new Date(i.borrow_date).getTime()) /
                (1000 * 60 * 60 * 24),
            );
            return days < 1 ? 1 : days;
          }),
        ),
        status: "Active",
        id_card_status: 1, // Assuming 1 means ID is checked/held
      },
      { transaction: t },
    );

    // 3. Attach the Invoice ID to the lines and bulk create them
    const linesWithInvoiceId = invoiceLinesData.map((line) => ({
      ...line,
      invoice_id: newInvoice.invoice_id,
    }));
    await models.InvoiceLine.bulkCreate(linesWithInvoiceId, { transaction: t });

    // 4. Inventory Deduction Engine
    for (const item of items) {
      const equipment = await models.Equipment.findByPk(item.equipment_id, {
        transaction: t,
      });

      if (!equipment)
        throw new AppError(`Equipment ID ${item.equipment_id} not found.`, 404);
      if (equipment.available_qty < item.borrow_quantity) {
        throw new AppError(
          `Not enough stock for ${equipment.equipment_name}.`,
          400,
        );
      }

      // Decrement available, increment rented
      await equipment.update(
        {
          available_qty: equipment.available_qty - item.borrow_quantity,
          rented_qty: equipment.rented_qty + item.borrow_quantity,
        },
        { transaction: t },
      );
    }

    // 5. Handle Advance Payments
    if (fees.advance > 0) {
      await models.Payment.create(
        {
          invoice_id: newInvoice.invoice_id,
          payment_amount: fees.advance,
          method: "Cash", // You can add a UI dropdown for this later (Card/Transfer)
        },
        { transaction: t },
      );

      // Deduct from Customer Deposit Wallet if they used it
      const customer = await models.Customer.findByPk(customer_id, {
        transaction: t,
      });
      if (customer && customer.deposit_balance > 0) {
        const newBalance = Math.max(0, customer.deposit_balance - fees.advance);
        await customer.update(
          { deposit_balance: newBalance },
          { transaction: t },
        );
      }
    }

    // 6. Generate the Audit Trace
    await models.InvoiceTrace.create(
      {
        invoice_id: newInvoice.invoice_id,
        actor_user_id: userId,
        event_category: "DISPATCH",
        event_action: "INVOICE_CREATED",
        comments: `Invoice generated for ${items.length} items. Total: Rs. ${grandTotal}.`,
        state_payload: { items, fees },
      },
      { transaction: t },
    );

    return newInvoice; // Transaction automatically commits if no errors are thrown!
  });
};
export const getAllInvoices = async (models, queryParams) => {
  const page = parseInt(queryParams.page) || 1;
  const limit = parseInt(queryParams.limit) || 20;
  const offset = (page - 1) * limit;

  // We join Customer details and Payment history so the frontend can build a rich receipt
  const { count, rows } = await models.Invoice.findAndCountAll({
    include: [
      {
        model: models.Customer,
        attributes: [
          "first_name",
          "last_name",
          "company_name",
          "customer_type",
          "phone_number",
          "is_id_retained_currently",
        ],
      },
      {
        model: models.InvoiceLine,
        include: [{ model: models.Equipment, attributes: ["equipment_name"] }],
      },
      {
        model: models.Payment,
        attributes: ["payment_amount", "payment_date", "method"],
      },
    ],
    limit,
    offset,
    order: [["issued_date", "DESC"]],
  });

  return { totalItems: count, invoices: rows };
};

export const processReturn = async (models, payload, userId) => {
  const {
    invoice_id,
    lines_returned,
    final_payment_amount,
    release_id_card,
    payment_method,
  } = payload;

  return await models.sequelize.transaction(async (t) => {
    const invoice = await models.Invoice.findByPk(invoice_id, {
      transaction: t,
    });
    if (!invoice || invoice.status === "Completed")
      throw new AppError("Invoice not found or already completed.", 400);

    let totalLateFees = 0;

    // 1. Process Each Returned Line Item
    for (const returnData of lines_returned) {
      const line = await models.InvoiceLine.findByPk(returnData.line_id, {
        transaction: t,
      });
      if (!line)
        throw new AppError(`Line item ${returnData.line_id} not found.`, 404);

      // Math: Calculate Late Fees based on expected vs actual dates
      const expectedDate = new Date(line.expected_return_date).getTime();
      const actualDate = new Date(returnData.actual_return_date).getTime();
      const daysLate = Math.ceil(
        (actualDate - expectedDate) / (1000 * 60 * 60 * 24),
      );

      let lineLateFee = 0;
      if (daysLate > 0) {
        lineLateFee =
          daysLate * line.locked_extra_daily_rate * returnData.returned_qty;
        totalLateFees += lineLateFee;
      }

      // Update the Line Item
      await line.update(
        {
          actual_return_date: returnData.actual_return_date,
          good_returned_qty: returnData.good_qty,
          defective_returned_qty: returnData.defective_qty,
          line_total_amount: Number(line.line_total_amount) + lineLateFee, // Append late fee to line total
          line_status: "Returned",
        },
        { transaction: t },
      );

      // 2. Inventory Adjustment
      const equipment = await models.Equipment.findByPk(line.equipment_id, {
        transaction: t,
      });
      const totalReturned = returnData.good_qty + returnData.defective_qty;

      // Good items go back to available. Defective items do NOT go back to available.
      await equipment.update(
        {
          available_qty: equipment.available_qty + returnData.good_qty,
          rented_qty: equipment.rented_qty - totalReturned,
        },
        { transaction: t },
      );

      // If defective, automatically log it to the Defect Table
      if (returnData.defective_qty > 0) {
        await models.DefectLog.create(
          {
            equipment_id: equipment.equipment_id,
            reported_on_invoice_id: invoice_id,
            defective_qty: returnData.defective_qty,
            status: "Pending Repair",
            reported_by: userId,
          },
          { transaction: t },
        );
      }
    }

    // 3. Apply Final Payments & Update Master Invoice
    const newGrandTotal = Number(invoice.total_amount) + totalLateFees;

    if (final_payment_amount > 0) {
      await models.Payment.create(
        {
          invoice_id,
          payment_amount: final_payment_amount,
          method: payment_method || "Cash",
        },
        { transaction: t },
      );
    }

    await invoice.update(
      {
        total_amount: newGrandTotal,
        status: "Completed",
        id_card_status: release_id_card ? 0 : invoice.id_card_status,
      },
      { transaction: t },
    );

    // 4. Release ID Card on Customer Profile
    if (release_id_card) {
      await models.Customer.update(
        { is_id_retained_currently: false },
        { where: { customer_id: invoice.customer_id }, transaction: t },
      );
    }

    // 5. Audit Trace
    await models.InvoiceTrace.create(
      {
        invoice_id,
        actor_user_id: userId,
        event_category: "SETTLEMENT",
        event_action: "RETURN_PROCESSED",
        comments: `Return processed. Late fees added: Rs.${totalLateFees}. Final payment: Rs.${final_payment_amount}.`,
        state_payload: { lines_returned },
      },
      { transaction: t },
    );

    return true;
  });
};
