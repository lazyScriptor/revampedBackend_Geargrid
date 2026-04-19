import AppError from '../utils/AppError.js';

export const createDispatchInvoice = async (models, payload, userId) => {
  const { customer_id, items, fees } = payload;

  // Start a Managed SQL Transaction
  return await models.sequelize.transaction(async (t) => {
    
    // 1. Calculate Backend Totals (Never trust the frontend's total!)
    let subTotal = 0;
    
    // We map the incoming items to InvoiceLine format while calculating math
    const invoiceLinesData = items.map(item => {
      const start = new Date(item.borrow_date).getTime();
      const end = new Date(item.expected_return_date).getTime();
      let totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
      if (totalDays < 1 || isNaN(totalDays)) totalDays = 1;

      let lineTotal = 0;
      if (totalDays <= item.locked_minimum_days) {
        lineTotal = item.locked_base_price * item.borrow_quantity;
      } else {
        const extraDays = totalDays - item.locked_minimum_days;
        lineTotal = (item.locked_base_price + (extraDays * item.locked_extra_daily_rate)) * item.borrow_quantity;
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
        line_status: 'Active'
      };
    });

    const grandTotal = Math.max(0, subTotal + (fees.transport || 0) - (fees.discount || 0));

    // 2. Create the Master Invoice
    const newInvoice = await models.Invoice.create({
      customer_id,
      issued_by_user_id: userId,
      total_amount: grandTotal,
      advance_paid: fees.advance || 0,
      transport_fee: fees.transport || 0,
      discount_amount: fees.discount || 0,
      sub_total: subTotal,
      number_of_days_of_the_bill: Math.max(...items.map(i => {
         const days = Math.ceil((new Date(i.expected_return_date).getTime() - new Date(i.borrow_date).getTime()) / (1000*60*60*24));
         return days < 1 ? 1 : days;
      })),
      status: 'Active',
      id_card_status: 1 // Assuming 1 means ID is checked/held
    }, { transaction: t });

    // 3. Attach the Invoice ID to the lines and bulk create them
    const linesWithInvoiceId = invoiceLinesData.map(line => ({ ...line, invoice_id: newInvoice.invoice_id }));
    await models.InvoiceLine.bulkCreate(linesWithInvoiceId, { transaction: t });

    // 4. Inventory Deduction Engine
    for (const item of items) {
      const equipment = await models.Equipment.findByPk(item.equipment_id, { transaction: t });
      
      if (!equipment) throw new AppError(`Equipment ID ${item.equipment_id} not found.`, 404);
      if (equipment.available_qty < item.borrow_quantity) {
        throw new AppError(`Not enough stock for ${equipment.equipment_name}.`, 400);
      }

      // Decrement available, increment rented
      await equipment.update({
        available_qty: equipment.available_qty - item.borrow_quantity,
        rented_qty: equipment.rented_qty + item.borrow_quantity
      }, { transaction: t });
    }

    // 5. Handle Advance Payments
    if (fees.advance > 0) {
      await models.Payment.create({
        invoice_id: newInvoice.invoice_id,
        payment_amount: fees.advance,
        method: 'Cash', // You can add a UI dropdown for this later (Card/Transfer)
      }, { transaction: t });

      // Deduct from Customer Deposit Wallet if they used it
      const customer = await models.Customer.findByPk(customer_id, { transaction: t });
      if (customer && customer.deposit_balance > 0) {
         const newBalance = Math.max(0, customer.deposit_balance - fees.advance);
         await customer.update({ deposit_balance: newBalance }, { transaction: t });
      }
    }

    // 6. Generate the Audit Trace
    await models.InvoiceTrace.create({
      invoice_id: newInvoice.invoice_id,
      actor_user_id: userId,
      event_category: 'DISPATCH',
      event_action: 'INVOICE_CREATED',
      comments: `Invoice generated for ${items.length} items. Total: Rs. ${grandTotal}.`,
      state_payload: { items, fees }
    }, { transaction: t });

    return newInvoice; // Transaction automatically commits if no errors are thrown!
  });
};