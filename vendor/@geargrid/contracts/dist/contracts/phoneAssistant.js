import { z } from "zod";
import { successEnvelope } from "../envelope.js";
import { ISODate, Money, NonNegativeInt, PositiveInt } from "../primitives.js";
import { DeviceStatusEnum } from "./signatures.js";
// ─────────────────────────────────────────────────────────────────────────
// GearGrid Phone Assistant contracts (Release 1)
//
// Device routes are mounted at /api/device behind deviceAuth (headers:
//   x-device-id, x-tenant-db, Authorization: Bearer <device_token>).
// Staff routes sit under /api/phone-contacts, /api/calls, /api/invoices,
// /api/phone-assistant, and /api/me behind JWT protect + permissions.
// ─────────────────────────────────────────────────────────────────────────
export const ActiveBriefItemSchema = z.object({
    name: z.string(),
    qty: z.coerce.number().nonnegative(),
    due: z.string().nullable(),
    overdue_days: NonNegativeInt,
});
export const BriefLastPaymentSchema = z.object({
    amount: Money.nullable().optional(),
    date: z.string().nullable(),
    method: z.string().nullable(),
});
export const BriefRecentCallNoteSchema = z.object({
    note_id: PositiveInt.optional(),
    outcome: z.string().nullable().optional(),
    note_text: z.string().nullable().optional(),
    follow_up_on: z.string().nullable().optional(),
    author_name: z.string().nullable().optional(),
    created_at: ISODate.optional(),
});
export const CustomerBriefSchema = z.object({
    customer_id: PositiveInt,
    display_name: z.string(),
    company_name: z.string().nullable().optional(),
    parent_company: z.string().nullable().optional(),
    phones: z.array(z.string()),
    rating: z.number().nullable().optional(),
    nic_number: z.string().nullable().optional(),
    status: z.string(),
    blacklist_reason: z.string().nullable().optional(),
    balance_due: z.coerce.number().nullable().optional(),
    deposit_balance: z.coerce.number().nullable().optional(),
    has_dues: z.boolean().optional(),
    id_retained: z.boolean().optional(),
    active_items: z.array(ActiveBriefItemSchema).optional(),
    overdue_count: NonNegativeInt.optional(),
    max_overdue_days: NonNegativeInt.optional(),
    invoice_count: NonNegativeInt.optional(),
    first_rental: z.string().nullable().optional(),
    last_rental: z.string().nullable().optional(),
    last_payment: BriefLastPaymentSchema.nullable().optional(),
    last_review_comment: z.string().nullable().optional(),
    recent_call_notes: z.array(BriefRecentCallNoteSchema).optional(),
    summary_line: z.string(),
    earliest_overdue_due: z.string().nullable().optional(),
    updated_at: ISODate,
});
export const ContactMatchLiteSchema = z.object({
    contact_id: PositiveInt,
    display_name: z.string(),
    phone_e164: z.string(),
    device_label: z.string().nullable().optional(),
});
export const CallDirectionSchema = z.enum(["INCOMING", "OUTGOING", "MISSED"]);
export const CallStateSchema = z.enum(["RINGING", "ENDED"]);
// ── 1. Phone -> Server (/device/*) ─────────────────────────────────────────
export const CapabilityReasonEnum = z.enum([
    "plan",
    "shop_policy",
    "not_granted",
    "role",
    "phone_switch",
    "os_permission",
    "device_pending",
    "device_suspended",
    "device_revoked",
]);
export const ReportedStateSchema = z
    .object({
    call_screening_role: z.boolean().optional(),
    overlay_permission: z.boolean().optional(),
    notifications_permission: z.boolean().optional(),
    contacts_permission: z.boolean().optional(),
    call_log_permission: z.boolean().optional(),
    battery_optimization_exempt: z.boolean().optional(),
    sim_count: z.number().int().min(0).max(4).optional(),
    cached_briefs: z.number().int().nonnegative().optional(),
    outbox_pending: z.number().int().nonnegative().optional(),
    last_brief_sync_at: z.string().optional(),
    last_contact_sync_at: z.string().optional(),
    call_screen_unsupported: z.boolean().optional(),
})
    .passthrough();
export const PhoneAssistantApprovalModeEnum = z.enum([
    "admin_approves_all",
    "auto_approve_admin_phones",
    "auto_approve_all",
]);
export const RegisterDeviceContract = {
    path: "/device/register",
    method: "POST",
    body: z.object({
        app_version: z.string().min(1).max(20),
        push_token: z.string().max(512).nullable().optional(),
        contact_sync_enabled: z.boolean().optional(),
        device_model: z.string().trim().max(100).nullable().optional(),
        os_version: z.string().trim().max(20).nullable().optional(),
        reported_state: ReportedStateSchema.nullable().optional(),
        click_to_call_enabled: z.boolean().optional(),
        cached_briefs: z.number().int().nonnegative().optional(),
        brief_format: z.number().int().min(1).max(10).optional(),
        outbox_pending: z.number().int().nonnegative().optional(),
        last_brief_sync_at: ISODate.optional(),
        last_contact_sync_at: ISODate.optional(),
    }),
    response: successEnvelope(z.object({
        is_admin: z.boolean(),
        contact_sync_enabled: z.boolean(),
        device_status: DeviceStatusEnum.optional(),
        effective_capabilities: z.record(z.string(), z.boolean()).optional(),
        capability_reasons: z.record(z.string(), z.string().nullable()).optional(),
        offline_wipe_days: z.number().int().min(1).max(30).optional(),
        features: z
            .object({
            phone_assistant: z.boolean(),
        })
            .catchall(z.boolean()),
    })),
};
export const RotateDeviceTokenContract = {
    path: "/device/token/rotate",
    method: "POST",
    body: z.object({}).optional(),
    response: successEnvelope(z.object({
        device_token: z.string().min(16),
        expires_in_days: PositiveInt,
    })),
};
export const GetDeviceInvoiceContract = {
    path: "/device/invoices/:id",
    method: "GET",
    params: z.object({ id: PositiveInt }),
    response: successEnvelope(z.object({
        invoice_id: PositiveInt,
        invoice_number: z.string(),
        status: z.string(),
        issued_at: ISODate,
        customer: z.object({
            customer_id: PositiveInt.nullable(),
            name: z.string(),
            phone: z.string().nullable(),
        }),
        items: z.array(z.object({
            name: z.string(),
            quantity: z.coerce.number().nonnegative(),
            line_total: Money,
        })),
        total_amount: Money,
        paid_amount: Money,
        balance_due: Money,
        issued_by: z.string().nullable(),
    })),
};
export const ContactSyncUpsertSchema = z.object({
    key: z.string().min(1).max(64),
    name: z.string().min(1).max(255),
    phones: z.array(z.string().max(50)).max(20),
});
export const SyncDeviceContactsContract = {
    path: "/device/contacts/sync",
    method: "POST",
    body: z.object({
        full: z.boolean(),
        final: z.boolean().optional(),
        confirm_empty: z.boolean().optional(),
        upserts: z.array(ContactSyncUpsertSchema).max(500),
        deletes: z.array(z.string().min(1).max(64)).max(2000),
        seen_keys: z.array(z.string().min(1).max(64)).max(10000).optional(),
    }),
    response: successEnvelope(z.object({
        accepted: NonNegativeInt,
        skipped: NonNegativeInt,
        server_time: ISODate,
    })),
};
export const GetDeviceBriefsContract = {
    path: "/device/briefs",
    method: "GET",
    query: z.object({
        since: ISODate.optional(),
        cursor: NonNegativeInt.optional(),
        limit: PositiveInt.max(500).optional(),
    }),
    response: successEnvelope(z.object({
        briefs: z.array(CustomerBriefSchema),
        deleted_customer_ids: z.array(PositiveInt),
        next_cursor: PositiveInt.nullable(),
        server_time: ISODate,
    })),
};
export const LookupDeviceBriefContract = {
    path: "/device/briefs/lookup",
    method: "GET",
    query: z.object({
        phone: z.string().min(1).max(50),
    }),
    response: successEnvelope(z.object({
        match: z.enum(["customer", "contact", "none"]),
        brief: CustomerBriefSchema.nullable().optional(),
        briefs: z.array(CustomerBriefSchema).optional(),
        contact: ContactMatchLiteSchema.nullable().optional(),
    })),
};
export const PostDeviceCallContract = {
    path: "/device/calls",
    method: "POST",
    body: z.object({
        client_call_id: z.string().min(1).max(64),
        raw_number: z.string().max(50).nullable().optional(),
        direction: CallDirectionSchema,
        state: CallStateSchema,
        started_at: ISODate,
        ended_at: ISODate.nullable().optional(),
        duration_seconds: NonNegativeInt.nullable().optional(),
        sim_label: z.string().trim().max(40).nullable().optional(),
    }),
    response: successEnvelope(z.object({
        call_id: NonNegativeInt,
        client_call_id: z.string(),
        customer_id: PositiveInt.nullable(),
        contact_id: PositiveInt.nullable(),
        emitted: z.boolean(),
        skipped: z.boolean().optional(),
    })),
};
export const UnpairSelfDeviceContract = {
    path: "/device/unpair",
    method: "POST",
    response: successEnvelope(z.object({
        unpaired: z.boolean(),
    })),
};
// ── 2. Staff Phone Contacts & Invoices ─────────────────────────────────────
export const SearchPhoneContactsContract = {
    path: "/phone-contacts",
    method: "GET",
    query: z.object({
        search: z.string().trim().min(3).max(100),
        limit: PositiveInt.max(10).optional(),
    }),
    response: successEnvelope(z.object({
        contacts: z.array(z.object({
            contact_id: PositiveInt,
            operator_device_id: PositiveInt.nullable(),
            device_label: z.string().nullable(),
            display_name: z.string(),
            phone_e164: z.string(),
            raw_phone: z.string().nullable(),
            source: z.enum(["phone", "lead"]).optional(),
            notes: z.string().nullable().optional(),
        })),
    })),
};
export const UsePhoneContactContract = {
    path: "/phone-contacts/:id/use",
    method: "POST",
    params: z.object({ id: PositiveInt }),
    body: z.object({
        phone: z.string().min(1).max(50),
    }),
    response: successEnvelope(z.object({
        contact_id: PositiveInt,
        first_name: z.string(),
        last_name: z.string(),
        phone_number: z.string(),
    })),
};
// ── 3. Calls (staff) ───────────────────────────────────────────────────────
export const CallNoteSchema = z.object({
    note_id: PositiveInt,
    call_id: PositiveInt,
    customer_id: PositiveInt.nullable(),
    contact_id: PositiveInt.nullable(),
    tags: z.array(z.string()),
    note: z.string().nullable(),
    follow_up_on: z.string().nullable(),
    follow_up_done_at: ISODate.nullable(),
    created_by_user_id: PositiveInt.nullable(),
    author_name: z.string().nullable().optional(),
    created_at: ISODate,
});
export const CreateCallNoteBodySchema = z.object({
    tags: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
    note: z.string().trim().max(2000).nullable().optional(),
    follow_up_on: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable()
        .optional(),
});
export const CallRecordSchema = z.object({
    call_id: PositiveInt,
    operator_device_id: PositiveInt,
    client_call_id: z.string(),
    phone_e164: z.string().nullable(),
    raw_number: z.string().nullable(),
    direction: CallDirectionSchema,
    customer_id: PositiveInt.nullable(),
    contact_id: PositiveInt.nullable(),
    started_at: ISODate,
    ended_at: ISODate.nullable(),
    duration_seconds: NonNegativeInt.nullable(),
    device_label: z.string().nullable().optional(),
    sim_label: z.string().nullable().optional(),
    number_masked: z.boolean().optional(),
    callback_handled_at: ISODate.nullable().optional(),
    notes: z.array(CallNoteSchema).optional(),
});
export const MissedCallItemSchema = CallRecordSchema.extend({
    customer_name: z.string().nullable(),
    contact_name: z.string().nullable(),
    brief: CustomerBriefSchema.nullable().optional(),
});
export const FollowUpItemSchema = CallNoteSchema.extend({
    customer_name: z.string().nullable(),
    contact_name: z.string().nullable(),
    phone_e164: z.string().nullable(),
    raw_number: z.string().nullable(),
});
export const ListFollowUpsQuerySchema = z.object({
    status: z.enum(["pending", "done", "all"]).optional().default("pending"),
    customer_id: PositiveInt.optional(),
    limit: PositiveInt.max(100).optional(),
});
export const UpdateFollowUpBodySchema = z.object({
    done: z.boolean().optional(),
    snooze_to: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable()
        .optional(),
});
export const GetCallByIdContract = {
    path: "/calls/:id",
    method: "GET",
    params: z.object({ id: PositiveInt }),
    response: successEnvelope(z.object({
        call: CallRecordSchema,
        match: z.enum(["customer", "contact", "none"]),
        brief: CustomerBriefSchema.nullable().optional(),
        contact: ContactMatchLiteSchema.nullable().optional(),
    })),
};
export const ListCallsContract = {
    path: "/calls",
    method: "GET",
    query: z.object({
        customer_id: PositiveInt.optional(),
        page: PositiveInt.optional(),
        limit: PositiveInt.max(100).optional(),
    }),
    response: successEnvelope(z.object({
        calls: z.array(CallRecordSchema.extend({
            customer_name: z.string().nullable().optional(),
            contact_name: z.string().nullable().optional(),
        })),
        total: NonNegativeInt,
        page: PositiveInt,
        limit: PositiveInt,
    })),
};
// ── 4. Push notification settings & preferences ────────────────────────────
export const PushDeliveryModeEnum = z.enum(["instant", "digest"]);
export const PushEventRuleSchema = z.object({
    enabled: z.boolean(),
    min_amount: z.coerce.number().nonnegative().default(0),
    recipient_role_ids: z.array(PositiveInt).default([]),
    hide_customer_name: z.boolean().optional(),
    hide_amount: z.boolean().optional(),
    delivery: PushDeliveryModeEnum.optional(),
});
export const DailySummarySectionsSchema = z.object({
    bills: z.boolean(),
    payments: z.boolean(),
    returns: z.boolean(),
    due_tomorrow: z.boolean(),
    overdue: z.boolean(),
});
export const DailySummarySettingsSchema = z.object({
    enabled: z.boolean(),
    send_time: z.string().regex(/^\d{2}:\d{2}$/),
    recipient_role_ids: z.array(PositiveInt).default([]),
    sections: DailySummarySectionsSchema,
});
export const PushSettingsPayloadSchema = z.object({
    events: z.record(z.string(), PushEventRuleSchema),
    quiet_hours: z.object({
        enabled: z.boolean(),
        from: z.string().regex(/^\d{2}:\d{2}$/),
        to: z.string().regex(/^\d{2}:\d{2}$/),
    }),
    include_amounts: z.boolean(),
    notify_actor: z.boolean(),
    digest_minutes: z.number().int().min(5).max(120).optional(),
    daily_summary: DailySummarySettingsSchema.optional(),
});
export const PushEventCatalogItemSchema = z.object({
    key: z.string(),
    group: z.string().optional(),
    default_enabled: z.boolean(),
    has_amount: z.boolean(),
});
export const GetPushSettingsContract = {
    path: "/phone-assistant/push-settings",
    method: "GET",
    response: successEnvelope(z.object({
        settings: PushSettingsPayloadSchema,
        catalog: z.array(PushEventCatalogItemSchema),
    })),
};
export const UpdatePushSettingsContract = {
    path: "/phone-assistant/push-settings",
    method: "PUT",
    body: PushSettingsPayloadSchema,
    response: successEnvelope(z.object({
        settings: PushSettingsPayloadSchema,
    })),
};
export const SendPushTestContract = {
    path: "/phone-assistant/push-test",
    method: "POST",
    response: successEnvelope(z.object({
        reached: NonNegativeInt,
    })),
};
export const UserPersonalQuietHoursSchema = z.object({
    enabled: z.boolean(),
    from: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
    to: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
});
export const UserPushPreferenceItemSchema = z.object({
    event_key: z.string(),
    group: z.string().optional(),
    eligible: z.boolean(),
    shop_enabled: z.boolean(),
    has_amount: z.boolean(),
    shop_min_amount: z.coerce.number().nonnegative(),
    enabled: z.boolean(),
    min_amount: z.coerce.number().nonnegative().nullable(),
});
export const UpdatePushPreferencesBodySchema = z.object({
    preferences: z.array(z.object({
        event_key: z.string().min(1).max(40),
        enabled: z.boolean(),
        min_amount: z.coerce.number().nonnegative().nullable().optional(),
    })),
    quiet_hours: UserPersonalQuietHoursSchema.optional(),
    muted: z.boolean().optional(),
});
export const GetMyPushPreferencesContract = {
    path: "/me/push-preferences",
    method: "GET",
    response: successEnvelope(z.object({
        preferences: z.array(UserPushPreferenceItemSchema),
        quiet_hours: UserPersonalQuietHoursSchema.optional(),
    })),
};
export const UpdateMyPushPreferencesContract = {
    path: "/me/push-preferences",
    method: "PUT",
    body: UpdatePushPreferencesBodySchema,
    response: successEnvelope(z.object({
        preferences: z.array(UserPushPreferenceItemSchema),
        quiet_hours: UserPersonalQuietHoursSchema.optional(),
    })),
};
export const GetDevicePushPreferencesContract = {
    path: "/device/push-preferences",
    method: "GET",
    response: successEnvelope(z.object({
        preferences: z.array(UserPushPreferenceItemSchema),
        quiet_hours: UserPersonalQuietHoursSchema.optional(),
        muted: z.boolean().optional(),
    })),
};
export const UpdateDevicePushPreferencesContract = {
    path: "/device/push-preferences",
    method: "PUT",
    body: UpdatePushPreferencesBodySchema,
    response: successEnvelope(z.object({
        preferences: z.array(UserPushPreferenceItemSchema),
        quiet_hours: UserPersonalQuietHoursSchema.optional(),
        muted: z.boolean().optional(),
    })),
};
// ── 5. Device Trust, Admin Console & Shop Policy (Release 2 Part B) ────────
export const ContactSyncModeEnum = z.enum([
    "off",
    "selected_labels",
    "selected_accounts",
    "all",
]);
export const CallLoggingScopeEnum = z.enum([
    "off",
    "customers_only",
    "customers_and_contacts",
    "all",
]);
export const ShopDeviceItemSchema = z.object({
    operator_device_id: PositiveInt,
    user_id: PositiveInt,
    staff_name: z.string(),
    staff_email: z.string().nullable(),
    staff_role_name: z.string().nullable(),
    staff_is_admin: z.boolean(),
    device_id: z.string(),
    device_label: z.string().nullable(),
    device_model: z.string().nullable(),
    os_version: z.string().nullable(),
    app_version: z.string().nullable(),
    is_native_app: z.boolean(),
    status: DeviceStatusEnum,
    paired_at: ISODate,
    last_seen_at: ISODate.nullable(),
    approved_by: PositiveInt.nullable(),
    approved_at: ISODate.nullable(),
    revoked_at: ISODate.nullable(),
    muted: z.boolean(),
    brief_profile_id: z.string().nullable(),
    contact_sync_enabled: z.boolean(),
    contact_sync_mode: z.string(),
    contacts_synced_at: ISODate.nullable(),
    contact_count: NonNegativeInt,
    call_logging_scope: z.string(),
    calls_logged_count: NonNegativeInt,
    sim_filter: z.string().nullable(),
    capabilities: z.record(z.string(), z.boolean()),
    effective_capabilities: z.record(z.string(), z.boolean()),
    capability_reasons: z.record(z.string(), z.string().nullable()),
    briefs_synced_at: ISODate.nullable().optional(),
    reported_state: ReportedStateSchema.nullable(),
    health_warnings: z.array(z.string()),
    version_status: z
        .enum(["up_to_date", "update_available", "update_required", "unknown"])
        .optional(),
});
export const ListShopDevicesContract = {
    path: "/phone-assistant/devices",
    method: "GET",
    query: z
        .object({
        status: z.string().optional(),
    })
        .optional(),
    response: successEnvelope(z.object({
        devices: z.array(ShopDeviceItemSchema),
        counts: z.object({
            total: NonNegativeInt,
            pending: NonNegativeInt,
            active: NonNegativeInt,
            suspended: NonNegativeInt,
            revoked: NonNegativeInt,
        }),
        min_app_version: z.string().optional(),
        latest_app_version: z.string().optional(),
    })),
};
export const UpdateShopDeviceContract = {
    path: "/phone-assistant/devices/:id",
    method: "PATCH",
    params: z.object({ id: PositiveInt }),
    body: z.object({
        device_label: z.string().trim().max(120).nullable().optional(),
        capabilities: z.record(z.string(), z.boolean()).optional(),
        brief_profile_id: z.string().trim().max(40).nullable().optional(),
        muted: z.boolean().optional(),
        contact_sync_mode: ContactSyncModeEnum.optional(),
        call_logging_scope: CallLoggingScopeEnum.optional(),
        sim_filter: z.string().trim().max(64).nullable().optional(),
        notification_language: z.enum(["en", "si", "ta", "si-Latn"]).nullable().optional(),
        app_language: z.enum(["follow_phone", "en", "si", "ta"]).nullable().optional(),
        call_text_scale: z.number().min(0.8).max(2).nullable().optional(),
        app_text_size: z.enum(["small", "default", "large", "extra_large"]).nullable().optional(),
        app_lock_enabled: z.boolean().optional(),
    }),
    response: successEnvelope(z.object({
        device: ShopDeviceItemSchema,
    })),
};
export const SetShopDeviceStatusContract = {
    path: "/phone-assistant/devices/:id/status",
    method: "POST",
    params: z.object({ id: PositiveInt }),
    body: z.object({
        status: DeviceStatusEnum,
        reason: z.string().trim().max(240).nullable().optional(),
    }),
    response: successEnvelope(z.object({
        device: ShopDeviceItemSchema,
    })),
};
export const WipeShopDeviceContract = {
    path: "/phone-assistant/devices/:id/wipe",
    method: "POST",
    params: z.object({ id: PositiveInt }),
    body: z
        .object({
        reason: z.string().trim().max(240).nullable().optional(),
    })
        .optional(),
    response: successEnvelope(z.object({
        wiped: z.boolean(),
        pushed: z.boolean(),
    })),
};
export const TestShopDevicePushContract = {
    path: "/phone-assistant/devices/:id/test-push",
    method: "POST",
    params: z.object({ id: PositiveInt }),
    body: z.object({}).optional(),
    response: successEnvelope(z.object({
        sent: z.boolean(),
        reason: z.string().nullable().optional(),
    })),
};
export const DeviceAuditLogItemSchema = z.object({
    audit_id: PositiveInt,
    operator_device_id: PositiveInt,
    actor_user_id: PositiveInt.nullable(),
    actor_name: z.string().nullable(),
    action: z.string(),
    detail: z.unknown().nullable(),
    created_at: ISODate,
});
export const GetShopDeviceAuditContract = {
    path: "/phone-assistant/devices/:id/audit",
    method: "GET",
    params: z.object({ id: PositiveInt }),
    response: successEnvelope(z.object({
        logs: z.array(DeviceAuditLogItemSchema),
    })),
};
export const BriefLockScreenModeEnum = z.enum([
    "full",
    "name_rating",
    "name_only",
    "hidden",
]);
export const BriefAmountModeEnum = z.enum([
    "exact",
    "rounded",
    "flag_only",
    "hidden",
]);
export const BriefProfileSchema = z.object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(100),
    fields: z.array(z.string()),
    lock_screen: BriefLockScreenModeEnum,
    amounts: BriefAmountModeEnum,
    call_screen: z.unknown().optional(),
});
export const OverlayPolicySchema = z.object({
    position: z.enum(["top", "bottom"]),
    auto_dismiss_seconds: z.number().int().min(0).max(60),
    show_for: z.enum(["incoming", "incoming_and_outgoing"]),
});
export const UnknownCallerModeEnum = z.enum([
    "show_not_in_geargrid",
    "show_nothing",
]);
export const SharedNumberModeEnum = z.enum(["list_all", "first_only"]);
export const ContactSyncPolicySchema = z.object({
    allowed_modes: z.array(ContactSyncModeEnum),
    fields: z.array(z.string()).default(["name_and_number"]),
});
export const CallLoggingPolicySchema = z.object({
    allowed_scopes: z.array(CallLoggingScopeEnum),
    store_unknown_numbers: z.boolean().default(false),
    business_hours_only: z.boolean().default(false),
    business_hours: z
        .object({
        from: z.string().regex(/^\d{2}:\d{2}$/),
        to: z.string().regex(/^\d{2}:\d{2}$/),
    })
        .optional(),
    retention_days: z.number().int().min(1).max(3650).default(180),
});
export const DEFAULT_AFTER_CALL_TAGS = [
    "Booking",
    "Payment promise",
    "Extension",
    "Complaint",
    "Price enquiry",
    "Wrong number",
];
export const AfterCallCardPolicySchema = z.object({
    enabled: z.boolean().default(true),
    tags: z
        .array(z.string().trim().min(1).max(60))
        .min(1)
        .max(20)
        .default([...DEFAULT_AFTER_CALL_TAGS]),
    auto_dismiss_seconds: z.number().int().min(0).max(120).default(25),
});
export const CallScreenSchema = z.object({
    version: z.literal(1),
    size: z.enum(["compact", "standard", "large", "extra_large"]),
    text_scale: z.number().min(0.8).max(2),
    shape: z.object({ width: z.enum(["inset", "full"]), corner_radius: z.number().int().min(0).max(28), position: z.enum(["top", "middle", "bottom"]), opacity: z.number().min(0.8).max(1), elevation: z.boolean() }),
    theme: z.object({ mode: z.enum(["auto", "light", "dark"]), accent: z.enum(["brand", "neutral"]), status_bar: z.boolean() }),
    header: z.object({ show_logo: z.boolean(), show_shop_name: z.boolean() }),
    rows: z.array(z.object({ field: z.string(), style: z.enum(["title", "emphasis", "body", "caption", "stars", "list", "chip"]), label: z.boolean().optional(), max_items: z.number().int().min(1).max(10).optional() })).min(1).max(16),
    rules: z.array(z.object({ when: z.enum(["status_blacklisted", "balance_due_over", "overdue_days_over", "rating_under", "id_retained", "unknown_caller"]), value: z.number().optional(), accent: z.enum(["danger", "warning", "brand", "neutral"]).optional(), banner: z.boolean().optional(), vibrate: z.boolean().optional() })).max(12),
    actions: z.array(z.enum(["dismiss", "add_note", "open_on_desktop", "open_app", "call_back_later"])).max(3),
    behaviour: z.object({ auto_dismiss_seconds: z.number().int().min(0).max(60), draggable: z.boolean(), tap_to_expand: z.boolean(), show_for: z.enum(["incoming", "incoming_and_outgoing"]), collapsed_rows: z.number().int().min(1).max(10) }),
    locked: z.object({ mode: BriefLockScreenModeEnum }),
});
export const SyncPolicySchema = z.object({ stale_after_minutes: z.number().int().min(1).max(10080), warn_after_hours: z.number().int().min(1).max(8760), show_sync_footer: z.enum(["always", "only_when_stale", "never"]) });
export const CallScreenPolicySchema = z.object({ allow_phone_text_scale: z.boolean(), min: z.number().min(0.8).max(2), max: z.number().min(0.8).max(2), respect_system_font: z.boolean() });
export const NotificationsLanguagePolicySchema = z.object({ default_language: z.enum(["en", "si", "ta", "si-Latn"]), allowed_languages: z.array(z.enum(["en", "si", "ta", "si-Latn"])).min(1), bilingual: z.enum(["off", "append_english"]), format: z.object({ currency: z.enum(["LKR", "Rs.", "රු."]), date: z.enum(["yyyy-mm-dd", "dd MMM", "dd/mm"]), time: z.enum(["24h", "12h"]), digits: z.literal("latin") }) });
export const FullAppPolicySchema = z.object({ enabled: z.boolean(), require_app_lock: z.boolean(), session_minutes: z.number().int().min(1).max(1440), block_screenshots: z.boolean() });
export const PhoneAssistantPolicySchema = z.object({
    approval_mode: PhoneAssistantApprovalModeEnum,
    auto_suspend_days: z.number().int().min(0).max(365),
    offline_wipe_days: z.number().int().min(1).max(30),
    capabilities: z.record(z.string(), z.boolean()),
    brief_profiles: z.array(BriefProfileSchema).optional(),
    default_profile_by_role: z.record(z.string(), z.string()).optional(),
    fallback_profile: z.string().optional(),
    cache_scope: z.string().optional(),
    overlay: OverlayPolicySchema.optional(),
    unknown_caller: UnknownCallerModeEnum.optional(),
    shared_number: SharedNumberModeEnum.optional(),
    desktop_popup: z.object({ roles: z.array(PositiveInt), size: z.enum(["compact", "standard", "large"]).optional() }).optional(),
    sync: SyncPolicySchema.optional(),
    call_screen: CallScreenPolicySchema.optional(),
    notifications: NotificationsLanguagePolicySchema.optional(),
    full_app: FullAppPolicySchema.optional(),
    contact_sync: ContactSyncPolicySchema.optional(),
    call_logging: CallLoggingPolicySchema.optional(),
    after_call_card: AfterCallCardPolicySchema.optional(),
});
export const GetPhoneAssistantPolicyContract = {
    path: "/phone-assistant/policy",
    method: "GET",
    response: successEnvelope(z.object({
        policy: PhoneAssistantPolicySchema,
    })),
};
export const UpdatePhoneAssistantPolicyContract = {
    path: "/phone-assistant/policy",
    method: "PUT",
    body: PhoneAssistantPolicySchema.partial(),
    response: successEnvelope(z.object({
        policy: PhoneAssistantPolicySchema,
    })),
};
export const PatchPhoneAssistantPolicyContract = {
    path: "/phone-assistant/policy",
    method: "PATCH",
    body: z.object({ updates: z.array(z.object({ path: z.string().min(1).max(120), value: z.unknown() })).min(1).max(30) }),
    response: successEnvelope(z.object({ policy: PhoneAssistantPolicySchema })),
};
export const DevicePolicyResponseSchema = z.object({
    device_status: DeviceStatusEnum,
    effective_capabilities: z.record(z.string(), z.boolean()),
    capability_reasons: z.record(z.string(), z.string().nullable()),
    brief_profile: BriefProfileSchema,
    cache_scope: z.string(),
    overlay: OverlayPolicySchema,
    unknown_caller: UnknownCallerModeEnum,
    shared_number: SharedNumberModeEnum,
    offline_wipe_days: z.number().int().min(1).max(30),
    contact_sync_mode: z.string(),
    call_logging_scope: z.string(),
    sim_filter: z.string().nullable(),
    muted: z.boolean(),
    contact_sync_policy: ContactSyncPolicySchema.optional(),
    call_logging_policy: CallLoggingPolicySchema.optional(),
    contact_count: NonNegativeInt.optional(),
    contacts_synced_at: ISODate.nullable().optional(),
    calls_logged_this_month: NonNegativeInt.optional(),
    paired_at: ISODate.nullable().optional(),
    consented_capabilities: z.record(z.string(), z.boolean()).optional(),
    after_call_card: AfterCallCardPolicySchema.optional(),
    call_screen: CallScreenSchema.optional(),
    sync: SyncPolicySchema.optional(),
    notification_languages: z.array(z.string()).optional(),
    full_app: FullAppPolicySchema.optional(),
    call_screen_policy: CallScreenPolicySchema.optional(),
    desktop_popup: z.object({ roles: z.array(PositiveInt), size: z.enum(["compact", "standard", "large"]).optional() }).optional(),
    notification_language: z.string().nullable().optional(),
    app_language: z.string().nullable().optional(),
    call_text_scale: z.number().nullable().optional(),
    app_text_size: z.string().nullable().optional(),
    app_lock_enabled: z.boolean().optional(),
    locked_by_policy: z.array(z.string()).optional(),
    min_app_version: z.string().optional(),
    latest_app_version: z.string().optional(),
});
export const GetDevicePolicyContract = {
    path: "/device/policy",
    method: "GET",
    response: successEnvelope(DevicePolicyResponseSchema),
};
export const UpdateDeviceSettingsContract = {
    path: "/device/settings",
    method: "PUT",
    body: z.object({
        muted: z.boolean().optional(),
        contact_sync_mode: ContactSyncModeEnum.optional(),
        call_logging_scope: CallLoggingScopeEnum.optional(),
        sim_filter: z.string().trim().max(64).nullable().optional(),
        notification_language: z.enum(["en", "si", "ta", "si-Latn"]).nullable().optional(),
        app_language: z.enum(["en", "si", "ta"]).nullable().optional(),
        call_text_scale: z.number().min(0.8).max(2).nullable().optional(),
        app_text_size: z.enum(["small", "default", "large", "extra_large"]).nullable().optional(),
        app_lock_enabled: z.boolean().optional(),
    }),
    response: successEnvelope(z.object({
        muted: z.boolean(),
        contact_sync_mode: z.string(),
        call_logging_scope: z.string(),
        sim_filter: z.string().nullable(),
        effective_capabilities: z.record(z.string(), z.boolean()),
        capability_reasons: z.record(z.string(), z.string().nullable()),
    })),
};
export const DeleteDeviceContactsContract = {
    path: "/device/contacts",
    method: "DELETE",
    response: successEnvelope(z.object({
        deleted: NonNegativeInt,
    })),
};
export const DeleteDeviceCallsContract = {
    path: "/device/calls",
    method: "DELETE",
    response: successEnvelope(z.object({
        deleted: NonNegativeInt,
    })),
};
// ── 6. Part D1-D3, D6: Call notes, missed-call queue & follow-ups ──────────
export const PostDeviceCallNoteContract = {
    path: "/device/calls/:client_call_id/note",
    method: "POST",
    params: z.object({ client_call_id: z.string().min(1).max(120) }),
    body: CreateCallNoteBodySchema,
    response: successEnvelope(z.object({
        note: CallNoteSchema,
    })),
};
export const PostStaffCallNoteContract = {
    path: "/calls/:id/note",
    method: "POST",
    params: z.object({ id: PositiveInt }),
    body: CreateCallNoteBodySchema,
    response: successEnvelope(z.object({
        note: CallNoteSchema,
    })),
};
export const ListMissedCallsContract = {
    path: "/calls/missed",
    method: "GET",
    query: z.object({
        limit: PositiveInt.max(100).optional(),
    }),
    response: successEnvelope(z.object({
        items: z.array(MissedCallItemSchema),
    })),
};
export const ListDeviceMissedCallsContract = {
    path: "/device/calls/missed",
    method: "GET",
    query: z.object({
        limit: PositiveInt.max(100).optional(),
    }),
    response: successEnvelope(z.object({
        items: z.array(MissedCallItemSchema),
    })),
};
export const MarkCallHandledContract = {
    path: "/calls/:id/handled",
    method: "POST",
    params: z.object({ id: PositiveInt }),
    response: successEnvelope(z.object({
        call_id: PositiveInt,
        callback_handled_at: ISODate,
    })),
};
export const MarkDeviceCallHandledContract = {
    path: "/device/calls/:id/handled",
    method: "POST",
    params: z.object({ id: PositiveInt }),
    response: successEnvelope(z.object({
        call_id: PositiveInt,
        callback_handled_at: ISODate,
    })),
};
export const ListFollowUpsContract = {
    path: "/follow-ups",
    method: "GET",
    query: ListFollowUpsQuerySchema,
    response: successEnvelope(z.object({
        items: z.array(FollowUpItemSchema),
    })),
};
export const ListDeviceFollowUpsContract = {
    path: "/device/follow-ups",
    method: "GET",
    query: ListFollowUpsQuerySchema,
    response: successEnvelope(z.object({
        items: z.array(FollowUpItemSchema),
    })),
};
export const UpdateFollowUpContract = {
    path: "/follow-ups/:id",
    method: "PATCH",
    params: z.object({ id: PositiveInt }),
    body: UpdateFollowUpBodySchema,
    response: successEnvelope(z.object({
        follow_up: FollowUpItemSchema,
    })),
};
export const UpdateDeviceFollowUpContract = {
    path: "/device/follow-ups/:id",
    method: "PATCH",
    params: z.object({ id: PositiveInt }),
    body: UpdateFollowUpBodySchema,
    response: successEnvelope(z.object({
        follow_up: FollowUpItemSchema,
    })),
};
// ── 7. Part D4, D5, D7: Click-to-call, Send to counter & Leads ────────────
export const DialCallBodySchema = z.object({
    phone: z.string().trim().min(3).max(50),
});
export const DialCallResponseSchema = z.object({
    sent: NonNegativeInt,
    total_devices: NonNegativeInt,
    phone: z.string(),
});
export const DialCallContract = {
    path: "/calls/dial",
    method: "POST",
    body: DialCallBodySchema,
    response: successEnvelope(DialCallResponseSchema),
};
export const PostDeviceOpenCustomerBodySchema = z.object({
    customer_id: PositiveInt,
    call_id: z.union([PositiveInt, z.string().trim().min(1).max(120)]).nullable().optional(),
});
export const PostDeviceOpenCustomerResponseSchema = z.object({
    emitted: z.boolean(),
    customer_id: PositiveInt,
});
export const PostDeviceOpenCustomerContract = {
    path: "/device/pos/open-customer",
    method: "POST",
    body: PostDeviceOpenCustomerBodySchema,
    response: successEnvelope(PostDeviceOpenCustomerResponseSchema),
};
export const CreateLeadContactBodySchema = z.object({
    display_name: z.string().trim().min(1).max(255),
    phone: z.string().trim().min(3).max(50),
    note: z.string().trim().max(500).nullable().optional(),
    call_id: z.union([PositiveInt, z.string().trim().min(1).max(120)]).nullable().optional(),
});
export const LeadContactItemSchema = z.object({
    contact_id: PositiveInt,
    display_name: z.string(),
    phone_e164: z.string(),
    raw_phone: z.string().nullable(),
    source: z.literal("lead"),
    notes: z.string().nullable(),
    created_by_user_id: PositiveInt.nullable().optional(),
});
export const CreateLeadContactContract = {
    path: "/phone-contacts/leads",
    method: "POST",
    body: CreateLeadContactBodySchema,
    response: successEnvelope(z.object({
        lead: LeadContactItemSchema,
    })),
};
export const CreateDeviceLeadContactContract = {
    path: "/device/leads",
    method: "POST",
    body: CreateLeadContactBodySchema,
    response: successEnvelope(z.object({
        lead: LeadContactItemSchema,
    })),
};
export const PushTemplateSchema = z.object({
    event_key: z.string(), language: z.enum(["en", "si", "ta", "si-Latn"]), title: z.string().max(160), body: z.string().max(500),
    title_private: z.string().max(160).nullable().optional(), body_private: z.string().max(500).nullable().optional(), edited: z.boolean().optional(),
});
export const GetPushTemplatesContract = {
    path: "/phone-assistant/templates", method: "GET",
    response: successEnvelope(z.object({ templates: z.array(PushTemplateSchema), languages: z.array(z.string()), events: z.array(z.object({ key: z.string(), placeholders: z.array(z.string()) })) })),
};
export const PutPushTemplateContract = {
    path: "/phone-assistant/templates/:event_key/:language", method: "PUT",
    params: z.object({ event_key: z.string(), language: z.enum(["en", "si", "ta", "si-Latn"]) }),
    body: PushTemplateSchema.omit({ event_key: true, language: true, edited: true }),
    response: successEnvelope(z.object({ template: PushTemplateSchema })),
};
export const DeletePushTemplateContract = {
    path: "/phone-assistant/templates/:event_key/:language", method: "DELETE", params: z.object({ event_key: z.string(), language: z.enum(["en", "si", "ta", "si-Latn"]) }), response: successEnvelope(z.object({ restored: z.boolean() })),
};
export const PreviewPushTemplateContract = {
    path: "/phone-assistant/templates/preview", method: "POST",
    body: z.object({ event_key: z.string(), language: z.enum(["en", "si", "ta", "si-Latn"]), title: z.string().max(160), body: z.string().max(500), title_private: z.string().max(160).nullable().optional(), body_private: z.string().max(500).nullable().optional() }),
    response: successEnvelope(z.object({ normal: z.object({ title: z.string(), body: z.string() }), private: z.object({ title: z.string(), body: z.string() }) })),
};
export const SendCallScreenSampleContract = {
    path: "/phone-assistant/call-screen/sample",
    method: "POST",
    body: z.object({ profile_id: z.string().max(40).optional() }).optional(),
    response: successEnvelope(z.object({ reached: NonNegativeInt })),
};
export const SendPushTemplateTestContract = {
    path: "/phone-assistant/templates/test",
    method: "POST",
    body: z.object({
        event_key: z.string(),
        language: z.enum(["en", "si", "ta", "si-Latn"]),
        title: z.string().max(160),
        body: z.string().max(500),
        title_private: z.string().max(160).nullable().optional(),
        body_private: z.string().max(500).nullable().optional(),
        private: z.boolean().optional(),
    }),
    response: successEnvelope(z.object({ reached: NonNegativeInt, title: z.string(), body: z.string() })),
};
//# sourceMappingURL=phoneAssistant.js.map