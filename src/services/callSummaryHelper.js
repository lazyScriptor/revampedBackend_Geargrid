import { getCollectionsSettings } from "./collectionsSettingsService.js";
import { computeSuggestedOutcome } from "./callLogService.js";
import { dayInShopTz } from "../utils/rentalDays.js";

/**
 * Load last-call, tries-today, active/missed promise, follow-up, and unnoted-calls summary
 * for a list of customer IDs using a single grouped/windowed SQL query.
 * Gracefully returns an empty Map when CALL_LOGS/CALL_NOTES are unavailable (e.g. minimal unit-test mocks).
 */
export const loadCustomerCallSummaries = async (
  models,
  customerIds = [],
  { now = new Date(), tenantTz = "Asia/Colombo" } = {},
) => {
  const map = new Map();
  const ids = [...new Set((customerIds || []).map((id) => Number(id)).filter((id) => id > 0))];
  if (ids.length === 0 || !models?.CallLog || !models?.sequelize?.query) return map;

  const todayYmd = dayInShopTz(now, tenantTz);
  const selectType = models.sequelize?.constructor?.QueryTypes?.SELECT || "SELECT";

  let thresholdSeconds = 5;
  try {
    const settings = await getCollectionsSettings(models);
    thresholdSeconds = settings?.calls?.answeredThresholdSeconds ?? 5;
  } catch {
    thresholdSeconds = 5;
  }

  let rows = [];
  try {
    rows = await models.sequelize.query(
      `SELECT
        cl.call_id,
        cl.customer_id,
        cl.source,
        cl.direction,
        cl.started_at,
        cl.duration_seconds,
        cl.user_id AS manual_user_id,
        od.user_id AS device_user_id,
        COALESCE(
          NULLIF(TRIM(CONCAT(COALESCE(au.first_name, ''), ' ', COALESCE(au.last_name, ''))), ''),
          au.username,
          NULLIF(TRIM(CONCAT(COALESCE(mu.first_name, ''), ' ', COALESCE(mu.last_name, ''))), ''),
          mu.username,
          NULLIF(TRIM(CONCAT(COALESCE(du.first_name, ''), ' ', COALESCE(du.last_name, ''))), ''),
          du.username
        ) AS staff_name,
        COALESCE(cn.created_by_user_id, cl.user_id, od.user_id) AS staff_id,
        cn.note_id,
        cn.outcome,
        cn.result,
        cn.note,
        cn.promise_amount,
        DATE_FORMAT(cn.promise_date, '%Y-%m-%d') AS promise_date,
        cn.promise_status,
        cn.promise_kept_at,
        DATE_FORMAT(cn.follow_up_on, '%Y-%m-%d') AS follow_up_on,
        cn.follow_up_done_at
      FROM CALL_LOGS cl
      LEFT JOIN OPERATOR_DEVICES od ON od.operator_device_id = cl.operator_device_id
      LEFT JOIN USERS mu ON mu.user_id = cl.user_id
      LEFT JOIN USERS du ON du.user_id = od.user_id
      LEFT JOIN CALL_NOTES cn ON cn.note_id = (
        SELECT cn2.note_id
        FROM CALL_NOTES cn2
        WHERE cn2.call_id = cl.call_id
        ORDER BY cn2.note_id DESC
        LIMIT 1
      )
      LEFT JOIN USERS au ON au.user_id = cn.created_by_user_id
      WHERE cl.customer_id IN (:ids)
      ORDER BY cl.started_at DESC, cl.call_id DESC`,
      {
        replacements: { ids },
        type: selectType,
      },
    );
  } catch {
    return map;
  }

  for (const r of rows || []) {
    const cid = Number(r.customer_id);
    if (!map.has(cid)) {
      const startedAt = r.started_at ? new Date(r.started_at) : null;
      const minutesAgo =
        startedAt && !Number.isNaN(startedAt.getTime())
          ? Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 60000))
          : null;
      const dur =
        r.duration_seconds !== null && r.duration_seconds !== undefined
          ? Number(r.duration_seconds)
          : null;
      const staffName = r.staff_name ? String(r.staff_name).trim() : null;
      const calledByLabel =
        staffName && minutesAgo !== null
          ? `Called by ${staffName} ${minutesAgo} min ago`
          : null;

      map.set(cid, {
        call_id: Number(r.call_id),
        started_at: startedAt ? startedAt.toISOString() : null,
        minutes_ago: minutesAgo,
        direction: r.direction,
        duration_seconds: dur,
        suggested_outcome: computeSuggestedOutcome(dur, thresholdSeconds),
        outcome: r.outcome ?? null,
        result: r.result ?? null,
        note: r.note ?? null,
        has_note: r.note_id != null,
        staff_id: r.staff_id != null ? Number(r.staff_id) : null,
        staff_name: staffName,
        called_by_label: calledByLabel,
        tries_today: 0,
        unnoted_calls_count: 0,
        promise_amount:
          r.promise_amount !== null && r.promise_amount !== undefined
            ? Number(r.promise_amount)
            : null,
        promise_date: r.promise_date || null,
        promise_status: r.promise_status || null,
        promise_kept_at: r.promise_kept_at
          ? new Date(r.promise_kept_at).toISOString()
          : null,
        follow_up_on: r.follow_up_on || null,
        follow_up_done_at: r.follow_up_done_at
          ? new Date(r.follow_up_done_at).toISOString()
          : null,
        _called_today: false,
      });
    }

    const entry = map.get(cid);
    const callDay = r.started_at ? dayInShopTz(new Date(r.started_at), tenantTz) : null;
    if (callDay === todayYmd) {
      entry.tries_today += 1;
      entry._called_today = true;
    }
    if (r.note_id == null) {
      entry.unnoted_calls_count += 1;
    }

    // Preserve the latest active/missed promise if the most recent call didn't have one.
    if (!entry.promise_status && r.promise_status) {
      entry.promise_amount =
        r.promise_amount !== null && r.promise_amount !== undefined
          ? Number(r.promise_amount)
          : null;
      entry.promise_date = r.promise_date || null;
      entry.promise_status = r.promise_status;
      entry.promise_kept_at = r.promise_kept_at
        ? new Date(r.promise_kept_at).toISOString()
        : null;
    }

    // Preserve the latest pending follow-up if the most recent call didn't have one.
    if (!entry.follow_up_on && r.follow_up_on && !r.follow_up_done_at) {
      entry.follow_up_on = r.follow_up_on;
      entry.follow_up_done_at = null;
    }
  }

  return map;
};

export const matchesCallStateFilter = (summary, filter, { todayYmd } = {}) => {
  if (!filter || filter === "all") return true;
  switch (filter) {
    case "not_called":
    case "not_called_today":
      return !summary || !summary._called_today;
    case "no_answer":
      return (
        Boolean(summary) &&
        (summary.outcome === "no_answer" ||
          summary.outcome === "unreachable" ||
          (!summary.outcome && summary.suggested_outcome === "no_answer"))
      );
    case "promised":
      return Boolean(summary && summary.promise_status === "waiting");
    case "promise_missed":
      return Boolean(summary && summary.promise_status === "missed");
    case "call_again_today":
      return Boolean(
        summary &&
          summary.follow_up_on &&
          !summary.follow_up_done_at &&
          todayYmd &&
          summary.follow_up_on <= todayYmd,
      );
    case "calls_to_note":
      return Boolean(summary && summary.unnoted_calls_count > 0);
    default:
      return true;
  }
};

export const computeCallFilterCounts = (rows, summaryMap, { todayYmd } = {}) => {
  const counts = {
    not_called_today: 0,
    no_answer: 0,
    promised: 0,
    promise_missed: 0,
    call_again_today: 0,
    calls_to_note: 0,
  };
  for (const row of rows || []) {
    const cid = row.customer?.customer_id ?? row.customer_id;
    const summary = summaryMap.get(Number(cid)) || null;
    if (matchesCallStateFilter(summary, "not_called_today", { todayYmd })) {
      counts.not_called_today += 1;
    }
    if (matchesCallStateFilter(summary, "no_answer", { todayYmd })) {
      counts.no_answer += 1;
    }
    if (matchesCallStateFilter(summary, "promised", { todayYmd })) {
      counts.promised += 1;
    }
    if (matchesCallStateFilter(summary, "promise_missed", { todayYmd })) {
      counts.promise_missed += 1;
    }
    if (matchesCallStateFilter(summary, "call_again_today", { todayYmd })) {
      counts.call_again_today += 1;
    }
    if (matchesCallStateFilter(summary, "calls_to_note", { todayYmd })) {
      counts.calls_to_note += 1;
    }
  }
  return counts;
};
