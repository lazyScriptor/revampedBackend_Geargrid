/**
 * Thin stub for Slice 1's activityService — replaced at merge by Slice 1.
 */
export const recordActivity = async (
  _models,
  {
    type: _type,
    invoice_id: _invoiceId,
    customer_id: _customerId,
    actor_user_id: _actorUserId,
    amount: _amount,
    data: _data,
    occurred_at: _occurredAt,
    risk: _risk,
  } = {},
  { transaction: _transaction } = {},
) => null;

export default { recordActivity };
