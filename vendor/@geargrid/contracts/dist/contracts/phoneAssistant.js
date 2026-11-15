import { z } from "zod";
import { successEnvelope } from "../envelope.js";
import { ISODate, Money, NonNegativeInt, PositiveInt } from "../primitives.js";
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
export const CustomerBriefSchema = z.object({
    customer_id: PositiveInt,
    display_name: z.string(),
    company_name: z.string().nullable(),
    parent_company: z.string().nullable(),
    phones: z.array(z.string()),
    rating: z.number().nullable(),
    status: z.string(),
    balance_due: z.coerce.number(),
    deposit_balance: z.coerce.number(),
    id_retained: z.boolean(),
    active_items: z.array(ActiveBriefItemSchema),
    invoice_count: NonNegativeInt,
    first_rental: z.string().nullable(),
    last_rental: z.string().nullable(),
    last_payment: z
        .object({
        amount: Money,
        date: z.string().nullable(),
        method: z.string().nullable(),
    })
        .nullable(),
    last_review_comment: z.string().nullable(),
    summary_line: z.string(),
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
export const RegisterDeviceContract = {
    path: "/device/register",
    method: "POST",
    body: z.object({
        app_version: z.string().min(1).max(20),
        push_token: z.string().max(255).nullable().optional(),
        contact_sync_enabled: z.boolean().optional(),
    }),
    response: successEnvelope(z.object({
        is_admin: z.boolean(),
        contact_sync_enabled: z.boolean(),
        features: z
            .object({
            phone_assistant: z.boolean(),
        })
            .catchall(z.boolean()),
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
    }),
    response: successEnvelope(z.object({
        call_id: PositiveInt,
        client_call_id: z.string(),
        customer_id: PositiveInt.nullable(),
        contact_id: PositiveInt.nullable(),
        emitted: z.boolean(),
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
            operator_device_id: PositiveInt,
            device_label: z.string().nullable(),
            display_name: z.string(),
            phone_e164: z.string(),
            raw_phone: z.string().nullable(),
        })),
    })),
};
export const UsePhoneContactContract = {
    path: "/phone-contacts/:id/use",
    method: "POST",
    params: z.object({ id: PositiveInt }),
    response: successEnvelope(z.object({
        contact_id: PositiveInt,
        first_name: z.string(),
        last_name: z.string(),
        phone_number: z.string(),
    })),
};
// ── 3. Calls (staff) ───────────────────────────────────────────────────────
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
export const PushEventRuleSchema = z.object({
    enabled: z.boolean(),
    min_amount: z.coerce.number().nonnegative().default(0),
    recipient_role_ids: z.array(PositiveInt).default([]),
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
});
export const PushEventCatalogItemSchema = z.object({
    key: z.string(),
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
export const UserPushPreferenceItemSchema = z.object({
    event_key: z.string(),
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
});
export const GetMyPushPreferencesContract = {
    path: "/me/push-preferences",
    method: "GET",
    response: successEnvelope(z.object({
        preferences: z.array(UserPushPreferenceItemSchema),
    })),
};
export const UpdateMyPushPreferencesContract = {
    path: "/me/push-preferences",
    method: "PUT",
    body: UpdatePushPreferencesBodySchema,
    response: successEnvelope(z.object({
        preferences: z.array(UserPushPreferenceItemSchema),
    })),
};
export const GetDevicePushPreferencesContract = {
    path: "/device/push-preferences",
    method: "GET",
    response: successEnvelope(z.object({
        preferences: z.array(UserPushPreferenceItemSchema),
    })),
};
export const UpdateDevicePushPreferencesContract = {
    path: "/device/push-preferences",
    method: "PUT",
    body: UpdatePushPreferencesBodySchema,
    response: successEnvelope(z.object({
        preferences: z.array(UserPushPreferenceItemSchema),
    })),
};
//# sourceMappingURL=phoneAssistant.js.map