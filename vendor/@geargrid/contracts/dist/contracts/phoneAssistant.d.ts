import { z } from "zod";
export declare const ActiveBriefItemSchema: z.ZodObject<{
    name: z.ZodString;
    qty: z.ZodCoercedNumber<unknown>;
    due: z.ZodNullable<z.ZodString>;
    overdue_days: z.ZodCoercedNumber<unknown>;
}, z.core.$strip>;
export declare const BriefLastPaymentSchema: z.ZodObject<{
    amount: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    date: z.ZodNullable<z.ZodString>;
    method: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export declare const BriefRecentCallNoteSchema: z.ZodObject<{
    note_id: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    outcome: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    note_text: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    follow_up_on: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    author_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    created_at: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const CustomerBriefSchema: z.ZodObject<{
    customer_id: z.ZodCoercedNumber<unknown>;
    display_name: z.ZodString;
    company_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    parent_company: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    phones: z.ZodArray<z.ZodString>;
    rating: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    status: z.ZodString;
    blacklist_reason: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    balance_due: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    deposit_balance: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    has_dues: z.ZodOptional<z.ZodBoolean>;
    id_retained: z.ZodOptional<z.ZodBoolean>;
    active_items: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        qty: z.ZodCoercedNumber<unknown>;
        due: z.ZodNullable<z.ZodString>;
        overdue_days: z.ZodCoercedNumber<unknown>;
    }, z.core.$strip>>>;
    overdue_count: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    max_overdue_days: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    invoice_count: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    first_rental: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    last_rental: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    last_payment: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        amount: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
        date: z.ZodNullable<z.ZodString>;
        method: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>>;
    last_review_comment: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    recent_call_notes: z.ZodOptional<z.ZodArray<z.ZodObject<{
        note_id: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
        outcome: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        note_text: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        follow_up_on: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        author_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        created_at: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    summary_line: z.ZodString;
    earliest_overdue_due: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    updated_at: z.ZodString;
}, z.core.$strip>;
export type CustomerBrief = z.infer<typeof CustomerBriefSchema>;
export declare const ContactMatchLiteSchema: z.ZodObject<{
    contact_id: z.ZodCoercedNumber<unknown>;
    display_name: z.ZodString;
    phone_e164: z.ZodString;
    device_label: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export type ContactMatchLite = z.infer<typeof ContactMatchLiteSchema>;
export declare const CallDirectionSchema: z.ZodEnum<{
    INCOMING: "INCOMING";
    OUTGOING: "OUTGOING";
    MISSED: "MISSED";
}>;
export declare const CallStateSchema: z.ZodEnum<{
    RINGING: "RINGING";
    ENDED: "ENDED";
}>;
export declare const CapabilityReasonEnum: z.ZodEnum<{
    role: "role";
    plan: "plan";
    shop_policy: "shop_policy";
    not_granted: "not_granted";
    phone_switch: "phone_switch";
    os_permission: "os_permission";
    device_pending: "device_pending";
    device_suspended: "device_suspended";
    device_revoked: "device_revoked";
}>;
export type CapabilityReason = z.infer<typeof CapabilityReasonEnum>;
export declare const ReportedStateSchema: z.ZodObject<{
    call_screening_role: z.ZodOptional<z.ZodBoolean>;
    overlay_permission: z.ZodOptional<z.ZodBoolean>;
    notifications_permission: z.ZodOptional<z.ZodBoolean>;
    contacts_permission: z.ZodOptional<z.ZodBoolean>;
    call_log_permission: z.ZodOptional<z.ZodBoolean>;
    battery_optimization_exempt: z.ZodOptional<z.ZodBoolean>;
    sim_count: z.ZodOptional<z.ZodNumber>;
    cached_briefs: z.ZodOptional<z.ZodNumber>;
    outbox_pending: z.ZodOptional<z.ZodNumber>;
    last_brief_sync_at: z.ZodOptional<z.ZodString>;
    last_contact_sync_at: z.ZodOptional<z.ZodString>;
    call_screen_unsupported: z.ZodOptional<z.ZodBoolean>;
}, z.core.$loose>;
export type ReportedState = z.infer<typeof ReportedStateSchema>;
export declare const PhoneAssistantApprovalModeEnum: z.ZodEnum<{
    admin_approves_all: "admin_approves_all";
    auto_approve_admin_phones: "auto_approve_admin_phones";
    auto_approve_all: "auto_approve_all";
}>;
export type PhoneAssistantApprovalMode = z.infer<typeof PhoneAssistantApprovalModeEnum>;
export declare const RegisterDeviceContract: {
    readonly path: "/device/register";
    readonly method: "POST";
    readonly body: z.ZodObject<{
        app_version: z.ZodString;
        push_token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        contact_sync_enabled: z.ZodOptional<z.ZodBoolean>;
        device_model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        os_version: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        reported_state: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            call_screening_role: z.ZodOptional<z.ZodBoolean>;
            overlay_permission: z.ZodOptional<z.ZodBoolean>;
            notifications_permission: z.ZodOptional<z.ZodBoolean>;
            contacts_permission: z.ZodOptional<z.ZodBoolean>;
            call_log_permission: z.ZodOptional<z.ZodBoolean>;
            battery_optimization_exempt: z.ZodOptional<z.ZodBoolean>;
            sim_count: z.ZodOptional<z.ZodNumber>;
            cached_briefs: z.ZodOptional<z.ZodNumber>;
            outbox_pending: z.ZodOptional<z.ZodNumber>;
            last_brief_sync_at: z.ZodOptional<z.ZodString>;
            last_contact_sync_at: z.ZodOptional<z.ZodString>;
            call_screen_unsupported: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$loose>>>;
        click_to_call_enabled: z.ZodOptional<z.ZodBoolean>;
        cached_briefs: z.ZodOptional<z.ZodNumber>;
        brief_format: z.ZodOptional<z.ZodNumber>;
        outbox_pending: z.ZodOptional<z.ZodNumber>;
        last_brief_sync_at: z.ZodOptional<z.ZodString>;
        last_contact_sync_at: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            is_admin: z.ZodBoolean;
            contact_sync_enabled: z.ZodBoolean;
            device_status: z.ZodOptional<z.ZodEnum<{
                PENDING: "PENDING";
                ACTIVE: "ACTIVE";
                SUSPENDED: "SUSPENDED";
                REVOKED: "REVOKED";
            }>>;
            effective_capabilities: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
            capability_reasons: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNullable<z.ZodString>>>;
            offline_wipe_days: z.ZodOptional<z.ZodNumber>;
            features: z.ZodObject<{
                phone_assistant: z.ZodBoolean;
            }, z.core.$catchall<z.ZodBoolean>>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const RotateDeviceTokenContract: {
    readonly path: "/device/token/rotate";
    readonly method: "POST";
    readonly body: z.ZodOptional<z.ZodObject<{}, z.core.$strip>>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            device_token: z.ZodString;
            expires_in_days: z.ZodCoercedNumber<unknown>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const GetDeviceInvoiceContract: {
    readonly path: "/device/invoices/:id";
    readonly method: "GET";
    readonly params: z.ZodObject<{
        id: z.ZodCoercedNumber<unknown>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            invoice_id: z.ZodCoercedNumber<unknown>;
            invoice_number: z.ZodString;
            status: z.ZodString;
            issued_at: z.ZodString;
            customer: z.ZodObject<{
                customer_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                name: z.ZodString;
                phone: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>;
            items: z.ZodArray<z.ZodObject<{
                name: z.ZodString;
                quantity: z.ZodCoercedNumber<unknown>;
                line_total: z.ZodCoercedNumber<unknown>;
            }, z.core.$strip>>;
            total_amount: z.ZodCoercedNumber<unknown>;
            paid_amount: z.ZodCoercedNumber<unknown>;
            balance_due: z.ZodCoercedNumber<unknown>;
            issued_by: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const ContactSyncUpsertSchema: z.ZodObject<{
    key: z.ZodString;
    name: z.ZodString;
    phones: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export declare const SyncDeviceContactsContract: {
    readonly path: "/device/contacts/sync";
    readonly method: "POST";
    readonly body: z.ZodObject<{
        full: z.ZodBoolean;
        final: z.ZodOptional<z.ZodBoolean>;
        confirm_empty: z.ZodOptional<z.ZodBoolean>;
        upserts: z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            name: z.ZodString;
            phones: z.ZodArray<z.ZodString>;
        }, z.core.$strip>>;
        deletes: z.ZodArray<z.ZodString>;
        seen_keys: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            accepted: z.ZodCoercedNumber<unknown>;
            skipped: z.ZodCoercedNumber<unknown>;
            server_time: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const GetDeviceBriefsContract: {
    readonly path: "/device/briefs";
    readonly method: "GET";
    readonly query: z.ZodObject<{
        since: z.ZodOptional<z.ZodString>;
        cursor: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
        limit: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            briefs: z.ZodArray<z.ZodObject<{
                customer_id: z.ZodCoercedNumber<unknown>;
                display_name: z.ZodString;
                company_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                parent_company: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                phones: z.ZodArray<z.ZodString>;
                rating: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                status: z.ZodString;
                blacklist_reason: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                balance_due: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
                deposit_balance: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
                has_dues: z.ZodOptional<z.ZodBoolean>;
                id_retained: z.ZodOptional<z.ZodBoolean>;
                active_items: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    name: z.ZodString;
                    qty: z.ZodCoercedNumber<unknown>;
                    due: z.ZodNullable<z.ZodString>;
                    overdue_days: z.ZodCoercedNumber<unknown>;
                }, z.core.$strip>>>;
                overdue_count: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
                max_overdue_days: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
                invoice_count: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
                first_rental: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                last_rental: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                last_payment: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                    amount: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
                    date: z.ZodNullable<z.ZodString>;
                    method: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>>;
                last_review_comment: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                recent_call_notes: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    note_id: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
                    outcome: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    note_text: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    follow_up_on: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    author_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    created_at: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>>;
                summary_line: z.ZodString;
                earliest_overdue_due: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                updated_at: z.ZodString;
            }, z.core.$strip>>;
            deleted_customer_ids: z.ZodArray<z.ZodCoercedNumber<unknown>>;
            next_cursor: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
            server_time: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const LookupDeviceBriefContract: {
    readonly path: "/device/briefs/lookup";
    readonly method: "GET";
    readonly query: z.ZodObject<{
        phone: z.ZodString;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            match: z.ZodEnum<{
                customer: "customer";
                contact: "contact";
                none: "none";
            }>;
            brief: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                customer_id: z.ZodCoercedNumber<unknown>;
                display_name: z.ZodString;
                company_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                parent_company: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                phones: z.ZodArray<z.ZodString>;
                rating: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                status: z.ZodString;
                blacklist_reason: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                balance_due: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
                deposit_balance: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
                has_dues: z.ZodOptional<z.ZodBoolean>;
                id_retained: z.ZodOptional<z.ZodBoolean>;
                active_items: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    name: z.ZodString;
                    qty: z.ZodCoercedNumber<unknown>;
                    due: z.ZodNullable<z.ZodString>;
                    overdue_days: z.ZodCoercedNumber<unknown>;
                }, z.core.$strip>>>;
                overdue_count: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
                max_overdue_days: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
                invoice_count: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
                first_rental: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                last_rental: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                last_payment: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                    amount: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
                    date: z.ZodNullable<z.ZodString>;
                    method: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>>;
                last_review_comment: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                recent_call_notes: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    note_id: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
                    outcome: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    note_text: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    follow_up_on: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    author_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    created_at: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>>;
                summary_line: z.ZodString;
                earliest_overdue_due: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                updated_at: z.ZodString;
            }, z.core.$strip>>>;
            briefs: z.ZodOptional<z.ZodArray<z.ZodObject<{
                customer_id: z.ZodCoercedNumber<unknown>;
                display_name: z.ZodString;
                company_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                parent_company: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                phones: z.ZodArray<z.ZodString>;
                rating: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                status: z.ZodString;
                blacklist_reason: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                balance_due: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
                deposit_balance: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
                has_dues: z.ZodOptional<z.ZodBoolean>;
                id_retained: z.ZodOptional<z.ZodBoolean>;
                active_items: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    name: z.ZodString;
                    qty: z.ZodCoercedNumber<unknown>;
                    due: z.ZodNullable<z.ZodString>;
                    overdue_days: z.ZodCoercedNumber<unknown>;
                }, z.core.$strip>>>;
                overdue_count: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
                max_overdue_days: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
                invoice_count: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
                first_rental: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                last_rental: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                last_payment: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                    amount: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
                    date: z.ZodNullable<z.ZodString>;
                    method: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>>;
                last_review_comment: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                recent_call_notes: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    note_id: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
                    outcome: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    note_text: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    follow_up_on: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    author_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    created_at: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>>;
                summary_line: z.ZodString;
                earliest_overdue_due: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                updated_at: z.ZodString;
            }, z.core.$strip>>>;
            contact: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                contact_id: z.ZodCoercedNumber<unknown>;
                display_name: z.ZodString;
                phone_e164: z.ZodString;
                device_label: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            }, z.core.$strip>>>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const PostDeviceCallContract: {
    readonly path: "/device/calls";
    readonly method: "POST";
    readonly body: z.ZodObject<{
        client_call_id: z.ZodString;
        raw_number: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        direction: z.ZodEnum<{
            INCOMING: "INCOMING";
            OUTGOING: "OUTGOING";
            MISSED: "MISSED";
        }>;
        state: z.ZodEnum<{
            RINGING: "RINGING";
            ENDED: "ENDED";
        }>;
        started_at: z.ZodString;
        ended_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        duration_seconds: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
        sim_label: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            call_id: z.ZodCoercedNumber<unknown>;
            client_call_id: z.ZodString;
            customer_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
            contact_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
            emitted: z.ZodBoolean;
            skipped: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const UnpairSelfDeviceContract: {
    readonly path: "/device/unpair";
    readonly method: "POST";
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            unpaired: z.ZodBoolean;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const SearchPhoneContactsContract: {
    readonly path: "/phone-contacts";
    readonly method: "GET";
    readonly query: z.ZodObject<{
        search: z.ZodString;
        limit: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            contacts: z.ZodArray<z.ZodObject<{
                contact_id: z.ZodCoercedNumber<unknown>;
                operator_device_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                device_label: z.ZodNullable<z.ZodString>;
                display_name: z.ZodString;
                phone_e164: z.ZodString;
                raw_phone: z.ZodNullable<z.ZodString>;
                source: z.ZodOptional<z.ZodEnum<{
                    phone: "phone";
                    lead: "lead";
                }>>;
                notes: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            }, z.core.$strip>>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const UsePhoneContactContract: {
    readonly path: "/phone-contacts/:id/use";
    readonly method: "POST";
    readonly params: z.ZodObject<{
        id: z.ZodCoercedNumber<unknown>;
    }, z.core.$strip>;
    readonly body: z.ZodObject<{
        phone: z.ZodString;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            contact_id: z.ZodCoercedNumber<unknown>;
            first_name: z.ZodString;
            last_name: z.ZodString;
            phone_number: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const CallNoteSchema: z.ZodObject<{
    note_id: z.ZodCoercedNumber<unknown>;
    call_id: z.ZodCoercedNumber<unknown>;
    customer_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
    contact_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
    tags: z.ZodArray<z.ZodString>;
    note: z.ZodNullable<z.ZodString>;
    follow_up_on: z.ZodNullable<z.ZodString>;
    follow_up_done_at: z.ZodNullable<z.ZodString>;
    created_by_user_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
    author_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    created_at: z.ZodString;
}, z.core.$strip>;
export type CallNoteRecord = z.infer<typeof CallNoteSchema>;
export declare const CreateCallNoteBodySchema: z.ZodObject<{
    tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
    note: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    follow_up_on: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export type CreateCallNoteBody = z.infer<typeof CreateCallNoteBodySchema>;
export declare const CallRecordSchema: z.ZodObject<{
    call_id: z.ZodCoercedNumber<unknown>;
    operator_device_id: z.ZodCoercedNumber<unknown>;
    client_call_id: z.ZodString;
    phone_e164: z.ZodNullable<z.ZodString>;
    raw_number: z.ZodNullable<z.ZodString>;
    direction: z.ZodEnum<{
        INCOMING: "INCOMING";
        OUTGOING: "OUTGOING";
        MISSED: "MISSED";
    }>;
    customer_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
    contact_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
    started_at: z.ZodString;
    ended_at: z.ZodNullable<z.ZodString>;
    duration_seconds: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
    device_label: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    sim_label: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    number_masked: z.ZodOptional<z.ZodBoolean>;
    callback_handled_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    notes: z.ZodOptional<z.ZodArray<z.ZodObject<{
        note_id: z.ZodCoercedNumber<unknown>;
        call_id: z.ZodCoercedNumber<unknown>;
        customer_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
        contact_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
        tags: z.ZodArray<z.ZodString>;
        note: z.ZodNullable<z.ZodString>;
        follow_up_on: z.ZodNullable<z.ZodString>;
        follow_up_done_at: z.ZodNullable<z.ZodString>;
        created_by_user_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
        author_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        created_at: z.ZodString;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export declare const MissedCallItemSchema: z.ZodObject<{
    call_id: z.ZodCoercedNumber<unknown>;
    operator_device_id: z.ZodCoercedNumber<unknown>;
    client_call_id: z.ZodString;
    phone_e164: z.ZodNullable<z.ZodString>;
    raw_number: z.ZodNullable<z.ZodString>;
    direction: z.ZodEnum<{
        INCOMING: "INCOMING";
        OUTGOING: "OUTGOING";
        MISSED: "MISSED";
    }>;
    customer_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
    contact_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
    started_at: z.ZodString;
    ended_at: z.ZodNullable<z.ZodString>;
    duration_seconds: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
    device_label: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    sim_label: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    number_masked: z.ZodOptional<z.ZodBoolean>;
    callback_handled_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    notes: z.ZodOptional<z.ZodArray<z.ZodObject<{
        note_id: z.ZodCoercedNumber<unknown>;
        call_id: z.ZodCoercedNumber<unknown>;
        customer_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
        contact_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
        tags: z.ZodArray<z.ZodString>;
        note: z.ZodNullable<z.ZodString>;
        follow_up_on: z.ZodNullable<z.ZodString>;
        follow_up_done_at: z.ZodNullable<z.ZodString>;
        created_by_user_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
        author_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        created_at: z.ZodString;
    }, z.core.$strip>>>;
    customer_name: z.ZodNullable<z.ZodString>;
    contact_name: z.ZodNullable<z.ZodString>;
    brief: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        customer_id: z.ZodCoercedNumber<unknown>;
        display_name: z.ZodString;
        company_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        parent_company: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        phones: z.ZodArray<z.ZodString>;
        rating: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        status: z.ZodString;
        blacklist_reason: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        balance_due: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
        deposit_balance: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
        has_dues: z.ZodOptional<z.ZodBoolean>;
        id_retained: z.ZodOptional<z.ZodBoolean>;
        active_items: z.ZodOptional<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            qty: z.ZodCoercedNumber<unknown>;
            due: z.ZodNullable<z.ZodString>;
            overdue_days: z.ZodCoercedNumber<unknown>;
        }, z.core.$strip>>>;
        overdue_count: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
        max_overdue_days: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
        invoice_count: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
        first_rental: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        last_rental: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        last_payment: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            amount: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
            date: z.ZodNullable<z.ZodString>;
            method: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>>;
        last_review_comment: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        recent_call_notes: z.ZodOptional<z.ZodArray<z.ZodObject<{
            note_id: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
            outcome: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            note_text: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            follow_up_on: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            author_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            created_at: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
        summary_line: z.ZodString;
        earliest_overdue_due: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        updated_at: z.ZodString;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export type MissedCallItem = z.infer<typeof MissedCallItemSchema>;
export declare const FollowUpItemSchema: z.ZodObject<{
    note_id: z.ZodCoercedNumber<unknown>;
    call_id: z.ZodCoercedNumber<unknown>;
    customer_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
    contact_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
    tags: z.ZodArray<z.ZodString>;
    note: z.ZodNullable<z.ZodString>;
    follow_up_on: z.ZodNullable<z.ZodString>;
    follow_up_done_at: z.ZodNullable<z.ZodString>;
    created_by_user_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
    author_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    created_at: z.ZodString;
    customer_name: z.ZodNullable<z.ZodString>;
    contact_name: z.ZodNullable<z.ZodString>;
    phone_e164: z.ZodNullable<z.ZodString>;
    raw_number: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export type FollowUpItem = z.infer<typeof FollowUpItemSchema>;
export declare const ListFollowUpsQuerySchema: z.ZodObject<{
    status: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
        pending: "pending";
        done: "done";
        all: "all";
    }>>>;
    customer_id: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    limit: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export declare const UpdateFollowUpBodySchema: z.ZodObject<{
    done: z.ZodOptional<z.ZodBoolean>;
    snooze_to: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export type UpdateFollowUpBody = z.infer<typeof UpdateFollowUpBodySchema>;
export declare const GetCallByIdContract: {
    readonly path: "/calls/:id";
    readonly method: "GET";
    readonly params: z.ZodObject<{
        id: z.ZodCoercedNumber<unknown>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            call: z.ZodObject<{
                call_id: z.ZodCoercedNumber<unknown>;
                operator_device_id: z.ZodCoercedNumber<unknown>;
                client_call_id: z.ZodString;
                phone_e164: z.ZodNullable<z.ZodString>;
                raw_number: z.ZodNullable<z.ZodString>;
                direction: z.ZodEnum<{
                    INCOMING: "INCOMING";
                    OUTGOING: "OUTGOING";
                    MISSED: "MISSED";
                }>;
                customer_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                contact_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                started_at: z.ZodString;
                ended_at: z.ZodNullable<z.ZodString>;
                duration_seconds: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                device_label: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                sim_label: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                number_masked: z.ZodOptional<z.ZodBoolean>;
                callback_handled_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                notes: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    note_id: z.ZodCoercedNumber<unknown>;
                    call_id: z.ZodCoercedNumber<unknown>;
                    customer_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                    contact_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                    tags: z.ZodArray<z.ZodString>;
                    note: z.ZodNullable<z.ZodString>;
                    follow_up_on: z.ZodNullable<z.ZodString>;
                    follow_up_done_at: z.ZodNullable<z.ZodString>;
                    created_by_user_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                    author_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    created_at: z.ZodString;
                }, z.core.$strip>>>;
            }, z.core.$strip>;
            match: z.ZodEnum<{
                customer: "customer";
                contact: "contact";
                none: "none";
            }>;
            brief: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                customer_id: z.ZodCoercedNumber<unknown>;
                display_name: z.ZodString;
                company_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                parent_company: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                phones: z.ZodArray<z.ZodString>;
                rating: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                status: z.ZodString;
                blacklist_reason: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                balance_due: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
                deposit_balance: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
                has_dues: z.ZodOptional<z.ZodBoolean>;
                id_retained: z.ZodOptional<z.ZodBoolean>;
                active_items: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    name: z.ZodString;
                    qty: z.ZodCoercedNumber<unknown>;
                    due: z.ZodNullable<z.ZodString>;
                    overdue_days: z.ZodCoercedNumber<unknown>;
                }, z.core.$strip>>>;
                overdue_count: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
                max_overdue_days: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
                invoice_count: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
                first_rental: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                last_rental: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                last_payment: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                    amount: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
                    date: z.ZodNullable<z.ZodString>;
                    method: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>>;
                last_review_comment: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                recent_call_notes: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    note_id: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
                    outcome: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    note_text: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    follow_up_on: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    author_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    created_at: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>>;
                summary_line: z.ZodString;
                earliest_overdue_due: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                updated_at: z.ZodString;
            }, z.core.$strip>>>;
            contact: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                contact_id: z.ZodCoercedNumber<unknown>;
                display_name: z.ZodString;
                phone_e164: z.ZodString;
                device_label: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            }, z.core.$strip>>>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const ListCallsContract: {
    readonly path: "/calls";
    readonly method: "GET";
    readonly query: z.ZodObject<{
        customer_id: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
        page: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
        limit: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            calls: z.ZodArray<z.ZodObject<{
                call_id: z.ZodCoercedNumber<unknown>;
                operator_device_id: z.ZodCoercedNumber<unknown>;
                client_call_id: z.ZodString;
                phone_e164: z.ZodNullable<z.ZodString>;
                raw_number: z.ZodNullable<z.ZodString>;
                direction: z.ZodEnum<{
                    INCOMING: "INCOMING";
                    OUTGOING: "OUTGOING";
                    MISSED: "MISSED";
                }>;
                customer_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                contact_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                started_at: z.ZodString;
                ended_at: z.ZodNullable<z.ZodString>;
                duration_seconds: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                device_label: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                sim_label: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                number_masked: z.ZodOptional<z.ZodBoolean>;
                callback_handled_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                notes: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    note_id: z.ZodCoercedNumber<unknown>;
                    call_id: z.ZodCoercedNumber<unknown>;
                    customer_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                    contact_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                    tags: z.ZodArray<z.ZodString>;
                    note: z.ZodNullable<z.ZodString>;
                    follow_up_on: z.ZodNullable<z.ZodString>;
                    follow_up_done_at: z.ZodNullable<z.ZodString>;
                    created_by_user_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                    author_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    created_at: z.ZodString;
                }, z.core.$strip>>>;
                customer_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                contact_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            }, z.core.$strip>>;
            total: z.ZodCoercedNumber<unknown>;
            page: z.ZodCoercedNumber<unknown>;
            limit: z.ZodCoercedNumber<unknown>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const PushDeliveryModeEnum: z.ZodEnum<{
    instant: "instant";
    digest: "digest";
}>;
export type PushDeliveryMode = z.infer<typeof PushDeliveryModeEnum>;
export declare const PushEventRuleSchema: z.ZodObject<{
    enabled: z.ZodBoolean;
    min_amount: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    recipient_role_ids: z.ZodDefault<z.ZodArray<z.ZodCoercedNumber<unknown>>>;
    hide_customer_name: z.ZodOptional<z.ZodBoolean>;
    hide_amount: z.ZodOptional<z.ZodBoolean>;
    delivery: z.ZodOptional<z.ZodEnum<{
        instant: "instant";
        digest: "digest";
    }>>;
}, z.core.$strip>;
export declare const DailySummarySectionsSchema: z.ZodObject<{
    bills: z.ZodBoolean;
    payments: z.ZodBoolean;
    returns: z.ZodBoolean;
    due_tomorrow: z.ZodBoolean;
    overdue: z.ZodBoolean;
}, z.core.$strip>;
export declare const DailySummarySettingsSchema: z.ZodObject<{
    enabled: z.ZodBoolean;
    send_time: z.ZodString;
    recipient_role_ids: z.ZodDefault<z.ZodArray<z.ZodCoercedNumber<unknown>>>;
    sections: z.ZodObject<{
        bills: z.ZodBoolean;
        payments: z.ZodBoolean;
        returns: z.ZodBoolean;
        due_tomorrow: z.ZodBoolean;
        overdue: z.ZodBoolean;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const PushSettingsPayloadSchema: z.ZodObject<{
    events: z.ZodRecord<z.ZodString, z.ZodObject<{
        enabled: z.ZodBoolean;
        min_amount: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
        recipient_role_ids: z.ZodDefault<z.ZodArray<z.ZodCoercedNumber<unknown>>>;
        hide_customer_name: z.ZodOptional<z.ZodBoolean>;
        hide_amount: z.ZodOptional<z.ZodBoolean>;
        delivery: z.ZodOptional<z.ZodEnum<{
            instant: "instant";
            digest: "digest";
        }>>;
    }, z.core.$strip>>;
    quiet_hours: z.ZodObject<{
        enabled: z.ZodBoolean;
        from: z.ZodString;
        to: z.ZodString;
    }, z.core.$strip>;
    include_amounts: z.ZodBoolean;
    notify_actor: z.ZodBoolean;
    digest_minutes: z.ZodOptional<z.ZodNumber>;
    daily_summary: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodBoolean;
        send_time: z.ZodString;
        recipient_role_ids: z.ZodDefault<z.ZodArray<z.ZodCoercedNumber<unknown>>>;
        sections: z.ZodObject<{
            bills: z.ZodBoolean;
            payments: z.ZodBoolean;
            returns: z.ZodBoolean;
            due_tomorrow: z.ZodBoolean;
            overdue: z.ZodBoolean;
        }, z.core.$strip>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type PushSettingsPayload = z.infer<typeof PushSettingsPayloadSchema>;
export declare const PushEventCatalogItemSchema: z.ZodObject<{
    key: z.ZodString;
    group: z.ZodOptional<z.ZodString>;
    default_enabled: z.ZodBoolean;
    has_amount: z.ZodBoolean;
}, z.core.$strip>;
export declare const GetPushSettingsContract: {
    readonly path: "/phone-assistant/push-settings";
    readonly method: "GET";
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            settings: z.ZodObject<{
                events: z.ZodRecord<z.ZodString, z.ZodObject<{
                    enabled: z.ZodBoolean;
                    min_amount: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
                    recipient_role_ids: z.ZodDefault<z.ZodArray<z.ZodCoercedNumber<unknown>>>;
                    hide_customer_name: z.ZodOptional<z.ZodBoolean>;
                    hide_amount: z.ZodOptional<z.ZodBoolean>;
                    delivery: z.ZodOptional<z.ZodEnum<{
                        instant: "instant";
                        digest: "digest";
                    }>>;
                }, z.core.$strip>>;
                quiet_hours: z.ZodObject<{
                    enabled: z.ZodBoolean;
                    from: z.ZodString;
                    to: z.ZodString;
                }, z.core.$strip>;
                include_amounts: z.ZodBoolean;
                notify_actor: z.ZodBoolean;
                digest_minutes: z.ZodOptional<z.ZodNumber>;
                daily_summary: z.ZodOptional<z.ZodObject<{
                    enabled: z.ZodBoolean;
                    send_time: z.ZodString;
                    recipient_role_ids: z.ZodDefault<z.ZodArray<z.ZodCoercedNumber<unknown>>>;
                    sections: z.ZodObject<{
                        bills: z.ZodBoolean;
                        payments: z.ZodBoolean;
                        returns: z.ZodBoolean;
                        due_tomorrow: z.ZodBoolean;
                        overdue: z.ZodBoolean;
                    }, z.core.$strip>;
                }, z.core.$strip>>;
            }, z.core.$strip>;
            catalog: z.ZodArray<z.ZodObject<{
                key: z.ZodString;
                group: z.ZodOptional<z.ZodString>;
                default_enabled: z.ZodBoolean;
                has_amount: z.ZodBoolean;
            }, z.core.$strip>>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const UpdatePushSettingsContract: {
    readonly path: "/phone-assistant/push-settings";
    readonly method: "PUT";
    readonly body: z.ZodObject<{
        events: z.ZodRecord<z.ZodString, z.ZodObject<{
            enabled: z.ZodBoolean;
            min_amount: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
            recipient_role_ids: z.ZodDefault<z.ZodArray<z.ZodCoercedNumber<unknown>>>;
            hide_customer_name: z.ZodOptional<z.ZodBoolean>;
            hide_amount: z.ZodOptional<z.ZodBoolean>;
            delivery: z.ZodOptional<z.ZodEnum<{
                instant: "instant";
                digest: "digest";
            }>>;
        }, z.core.$strip>>;
        quiet_hours: z.ZodObject<{
            enabled: z.ZodBoolean;
            from: z.ZodString;
            to: z.ZodString;
        }, z.core.$strip>;
        include_amounts: z.ZodBoolean;
        notify_actor: z.ZodBoolean;
        digest_minutes: z.ZodOptional<z.ZodNumber>;
        daily_summary: z.ZodOptional<z.ZodObject<{
            enabled: z.ZodBoolean;
            send_time: z.ZodString;
            recipient_role_ids: z.ZodDefault<z.ZodArray<z.ZodCoercedNumber<unknown>>>;
            sections: z.ZodObject<{
                bills: z.ZodBoolean;
                payments: z.ZodBoolean;
                returns: z.ZodBoolean;
                due_tomorrow: z.ZodBoolean;
                overdue: z.ZodBoolean;
            }, z.core.$strip>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            settings: z.ZodObject<{
                events: z.ZodRecord<z.ZodString, z.ZodObject<{
                    enabled: z.ZodBoolean;
                    min_amount: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
                    recipient_role_ids: z.ZodDefault<z.ZodArray<z.ZodCoercedNumber<unknown>>>;
                    hide_customer_name: z.ZodOptional<z.ZodBoolean>;
                    hide_amount: z.ZodOptional<z.ZodBoolean>;
                    delivery: z.ZodOptional<z.ZodEnum<{
                        instant: "instant";
                        digest: "digest";
                    }>>;
                }, z.core.$strip>>;
                quiet_hours: z.ZodObject<{
                    enabled: z.ZodBoolean;
                    from: z.ZodString;
                    to: z.ZodString;
                }, z.core.$strip>;
                include_amounts: z.ZodBoolean;
                notify_actor: z.ZodBoolean;
                digest_minutes: z.ZodOptional<z.ZodNumber>;
                daily_summary: z.ZodOptional<z.ZodObject<{
                    enabled: z.ZodBoolean;
                    send_time: z.ZodString;
                    recipient_role_ids: z.ZodDefault<z.ZodArray<z.ZodCoercedNumber<unknown>>>;
                    sections: z.ZodObject<{
                        bills: z.ZodBoolean;
                        payments: z.ZodBoolean;
                        returns: z.ZodBoolean;
                        due_tomorrow: z.ZodBoolean;
                        overdue: z.ZodBoolean;
                    }, z.core.$strip>;
                }, z.core.$strip>>;
            }, z.core.$strip>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const SendPushTestContract: {
    readonly path: "/phone-assistant/push-test";
    readonly method: "POST";
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            reached: z.ZodCoercedNumber<unknown>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const UserPersonalQuietHoursSchema: z.ZodObject<{
    enabled: z.ZodBoolean;
    from: z.ZodNullable<z.ZodString>;
    to: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export type UserPersonalQuietHours = z.infer<typeof UserPersonalQuietHoursSchema>;
export declare const UserPushPreferenceItemSchema: z.ZodObject<{
    event_key: z.ZodString;
    group: z.ZodOptional<z.ZodString>;
    eligible: z.ZodBoolean;
    shop_enabled: z.ZodBoolean;
    has_amount: z.ZodBoolean;
    shop_min_amount: z.ZodCoercedNumber<unknown>;
    enabled: z.ZodBoolean;
    min_amount: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export type UserPushPreferenceItem = z.infer<typeof UserPushPreferenceItemSchema>;
export declare const UpdatePushPreferencesBodySchema: z.ZodObject<{
    preferences: z.ZodArray<z.ZodObject<{
        event_key: z.ZodString;
        enabled: z.ZodBoolean;
        min_amount: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    }, z.core.$strip>>;
    quiet_hours: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodBoolean;
        from: z.ZodNullable<z.ZodString>;
        to: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    muted: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const GetMyPushPreferencesContract: {
    readonly path: "/me/push-preferences";
    readonly method: "GET";
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            preferences: z.ZodArray<z.ZodObject<{
                event_key: z.ZodString;
                group: z.ZodOptional<z.ZodString>;
                eligible: z.ZodBoolean;
                shop_enabled: z.ZodBoolean;
                has_amount: z.ZodBoolean;
                shop_min_amount: z.ZodCoercedNumber<unknown>;
                enabled: z.ZodBoolean;
                min_amount: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
            }, z.core.$strip>>;
            quiet_hours: z.ZodOptional<z.ZodObject<{
                enabled: z.ZodBoolean;
                from: z.ZodNullable<z.ZodString>;
                to: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const UpdateMyPushPreferencesContract: {
    readonly path: "/me/push-preferences";
    readonly method: "PUT";
    readonly body: z.ZodObject<{
        preferences: z.ZodArray<z.ZodObject<{
            event_key: z.ZodString;
            enabled: z.ZodBoolean;
            min_amount: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
        }, z.core.$strip>>;
        quiet_hours: z.ZodOptional<z.ZodObject<{
            enabled: z.ZodBoolean;
            from: z.ZodNullable<z.ZodString>;
            to: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        muted: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            preferences: z.ZodArray<z.ZodObject<{
                event_key: z.ZodString;
                group: z.ZodOptional<z.ZodString>;
                eligible: z.ZodBoolean;
                shop_enabled: z.ZodBoolean;
                has_amount: z.ZodBoolean;
                shop_min_amount: z.ZodCoercedNumber<unknown>;
                enabled: z.ZodBoolean;
                min_amount: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
            }, z.core.$strip>>;
            quiet_hours: z.ZodOptional<z.ZodObject<{
                enabled: z.ZodBoolean;
                from: z.ZodNullable<z.ZodString>;
                to: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const GetDevicePushPreferencesContract: {
    readonly path: "/device/push-preferences";
    readonly method: "GET";
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            preferences: z.ZodArray<z.ZodObject<{
                event_key: z.ZodString;
                group: z.ZodOptional<z.ZodString>;
                eligible: z.ZodBoolean;
                shop_enabled: z.ZodBoolean;
                has_amount: z.ZodBoolean;
                shop_min_amount: z.ZodCoercedNumber<unknown>;
                enabled: z.ZodBoolean;
                min_amount: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
            }, z.core.$strip>>;
            quiet_hours: z.ZodOptional<z.ZodObject<{
                enabled: z.ZodBoolean;
                from: z.ZodNullable<z.ZodString>;
                to: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
            muted: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const UpdateDevicePushPreferencesContract: {
    readonly path: "/device/push-preferences";
    readonly method: "PUT";
    readonly body: z.ZodObject<{
        preferences: z.ZodArray<z.ZodObject<{
            event_key: z.ZodString;
            enabled: z.ZodBoolean;
            min_amount: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
        }, z.core.$strip>>;
        quiet_hours: z.ZodOptional<z.ZodObject<{
            enabled: z.ZodBoolean;
            from: z.ZodNullable<z.ZodString>;
            to: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        muted: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            preferences: z.ZodArray<z.ZodObject<{
                event_key: z.ZodString;
                group: z.ZodOptional<z.ZodString>;
                eligible: z.ZodBoolean;
                shop_enabled: z.ZodBoolean;
                has_amount: z.ZodBoolean;
                shop_min_amount: z.ZodCoercedNumber<unknown>;
                enabled: z.ZodBoolean;
                min_amount: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
            }, z.core.$strip>>;
            quiet_hours: z.ZodOptional<z.ZodObject<{
                enabled: z.ZodBoolean;
                from: z.ZodNullable<z.ZodString>;
                to: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
            muted: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const ContactSyncModeEnum: z.ZodEnum<{
    all: "all";
    off: "off";
    selected_labels: "selected_labels";
    selected_accounts: "selected_accounts";
}>;
export type ContactSyncMode = z.infer<typeof ContactSyncModeEnum>;
export declare const CallLoggingScopeEnum: z.ZodEnum<{
    all: "all";
    off: "off";
    customers_only: "customers_only";
    customers_and_contacts: "customers_and_contacts";
}>;
export type CallLoggingScope = z.infer<typeof CallLoggingScopeEnum>;
export declare const ShopDeviceItemSchema: z.ZodObject<{
    operator_device_id: z.ZodCoercedNumber<unknown>;
    user_id: z.ZodCoercedNumber<unknown>;
    staff_name: z.ZodString;
    staff_email: z.ZodNullable<z.ZodString>;
    staff_role_name: z.ZodNullable<z.ZodString>;
    staff_is_admin: z.ZodBoolean;
    device_id: z.ZodString;
    device_label: z.ZodNullable<z.ZodString>;
    device_model: z.ZodNullable<z.ZodString>;
    os_version: z.ZodNullable<z.ZodString>;
    app_version: z.ZodNullable<z.ZodString>;
    is_native_app: z.ZodBoolean;
    status: z.ZodEnum<{
        PENDING: "PENDING";
        ACTIVE: "ACTIVE";
        SUSPENDED: "SUSPENDED";
        REVOKED: "REVOKED";
    }>;
    paired_at: z.ZodString;
    last_seen_at: z.ZodNullable<z.ZodString>;
    approved_by: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
    approved_at: z.ZodNullable<z.ZodString>;
    revoked_at: z.ZodNullable<z.ZodString>;
    muted: z.ZodBoolean;
    brief_profile_id: z.ZodNullable<z.ZodString>;
    contact_sync_enabled: z.ZodBoolean;
    contact_sync_mode: z.ZodString;
    contacts_synced_at: z.ZodNullable<z.ZodString>;
    contact_count: z.ZodCoercedNumber<unknown>;
    call_logging_scope: z.ZodString;
    calls_logged_count: z.ZodCoercedNumber<unknown>;
    sim_filter: z.ZodNullable<z.ZodString>;
    capabilities: z.ZodRecord<z.ZodString, z.ZodBoolean>;
    effective_capabilities: z.ZodRecord<z.ZodString, z.ZodBoolean>;
    capability_reasons: z.ZodRecord<z.ZodString, z.ZodNullable<z.ZodString>>;
    briefs_synced_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    reported_state: z.ZodNullable<z.ZodObject<{
        call_screening_role: z.ZodOptional<z.ZodBoolean>;
        overlay_permission: z.ZodOptional<z.ZodBoolean>;
        notifications_permission: z.ZodOptional<z.ZodBoolean>;
        contacts_permission: z.ZodOptional<z.ZodBoolean>;
        call_log_permission: z.ZodOptional<z.ZodBoolean>;
        battery_optimization_exempt: z.ZodOptional<z.ZodBoolean>;
        sim_count: z.ZodOptional<z.ZodNumber>;
        cached_briefs: z.ZodOptional<z.ZodNumber>;
        outbox_pending: z.ZodOptional<z.ZodNumber>;
        last_brief_sync_at: z.ZodOptional<z.ZodString>;
        last_contact_sync_at: z.ZodOptional<z.ZodString>;
        call_screen_unsupported: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$loose>>;
    health_warnings: z.ZodArray<z.ZodString>;
    version_status: z.ZodOptional<z.ZodEnum<{
        unknown: "unknown";
        up_to_date: "up_to_date";
        update_available: "update_available";
        update_required: "update_required";
    }>>;
}, z.core.$strip>;
export type ShopDeviceItem = z.infer<typeof ShopDeviceItemSchema>;
export declare const ListShopDevicesContract: {
    readonly path: "/phone-assistant/devices";
    readonly method: "GET";
    readonly query: z.ZodOptional<z.ZodObject<{
        status: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            devices: z.ZodArray<z.ZodObject<{
                operator_device_id: z.ZodCoercedNumber<unknown>;
                user_id: z.ZodCoercedNumber<unknown>;
                staff_name: z.ZodString;
                staff_email: z.ZodNullable<z.ZodString>;
                staff_role_name: z.ZodNullable<z.ZodString>;
                staff_is_admin: z.ZodBoolean;
                device_id: z.ZodString;
                device_label: z.ZodNullable<z.ZodString>;
                device_model: z.ZodNullable<z.ZodString>;
                os_version: z.ZodNullable<z.ZodString>;
                app_version: z.ZodNullable<z.ZodString>;
                is_native_app: z.ZodBoolean;
                status: z.ZodEnum<{
                    PENDING: "PENDING";
                    ACTIVE: "ACTIVE";
                    SUSPENDED: "SUSPENDED";
                    REVOKED: "REVOKED";
                }>;
                paired_at: z.ZodString;
                last_seen_at: z.ZodNullable<z.ZodString>;
                approved_by: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                approved_at: z.ZodNullable<z.ZodString>;
                revoked_at: z.ZodNullable<z.ZodString>;
                muted: z.ZodBoolean;
                brief_profile_id: z.ZodNullable<z.ZodString>;
                contact_sync_enabled: z.ZodBoolean;
                contact_sync_mode: z.ZodString;
                contacts_synced_at: z.ZodNullable<z.ZodString>;
                contact_count: z.ZodCoercedNumber<unknown>;
                call_logging_scope: z.ZodString;
                calls_logged_count: z.ZodCoercedNumber<unknown>;
                sim_filter: z.ZodNullable<z.ZodString>;
                capabilities: z.ZodRecord<z.ZodString, z.ZodBoolean>;
                effective_capabilities: z.ZodRecord<z.ZodString, z.ZodBoolean>;
                capability_reasons: z.ZodRecord<z.ZodString, z.ZodNullable<z.ZodString>>;
                briefs_synced_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                reported_state: z.ZodNullable<z.ZodObject<{
                    call_screening_role: z.ZodOptional<z.ZodBoolean>;
                    overlay_permission: z.ZodOptional<z.ZodBoolean>;
                    notifications_permission: z.ZodOptional<z.ZodBoolean>;
                    contacts_permission: z.ZodOptional<z.ZodBoolean>;
                    call_log_permission: z.ZodOptional<z.ZodBoolean>;
                    battery_optimization_exempt: z.ZodOptional<z.ZodBoolean>;
                    sim_count: z.ZodOptional<z.ZodNumber>;
                    cached_briefs: z.ZodOptional<z.ZodNumber>;
                    outbox_pending: z.ZodOptional<z.ZodNumber>;
                    last_brief_sync_at: z.ZodOptional<z.ZodString>;
                    last_contact_sync_at: z.ZodOptional<z.ZodString>;
                    call_screen_unsupported: z.ZodOptional<z.ZodBoolean>;
                }, z.core.$loose>>;
                health_warnings: z.ZodArray<z.ZodString>;
                version_status: z.ZodOptional<z.ZodEnum<{
                    unknown: "unknown";
                    up_to_date: "up_to_date";
                    update_available: "update_available";
                    update_required: "update_required";
                }>>;
            }, z.core.$strip>>;
            counts: z.ZodObject<{
                total: z.ZodCoercedNumber<unknown>;
                pending: z.ZodCoercedNumber<unknown>;
                active: z.ZodCoercedNumber<unknown>;
                suspended: z.ZodCoercedNumber<unknown>;
                revoked: z.ZodCoercedNumber<unknown>;
            }, z.core.$strip>;
            min_app_version: z.ZodOptional<z.ZodString>;
            latest_app_version: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const UpdateShopDeviceContract: {
    readonly path: "/phone-assistant/devices/:id";
    readonly method: "PATCH";
    readonly params: z.ZodObject<{
        id: z.ZodCoercedNumber<unknown>;
    }, z.core.$strip>;
    readonly body: z.ZodObject<{
        device_label: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        capabilities: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
        brief_profile_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        muted: z.ZodOptional<z.ZodBoolean>;
        contact_sync_mode: z.ZodOptional<z.ZodEnum<{
            all: "all";
            off: "off";
            selected_labels: "selected_labels";
            selected_accounts: "selected_accounts";
        }>>;
        call_logging_scope: z.ZodOptional<z.ZodEnum<{
            all: "all";
            off: "off";
            customers_only: "customers_only";
            customers_and_contacts: "customers_and_contacts";
        }>>;
        sim_filter: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        notification_language: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
            en: "en";
            si: "si";
            ta: "ta";
            "si-Latn": "si-Latn";
        }>>>;
        app_language: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
            en: "en";
            si: "si";
            ta: "ta";
            follow_phone: "follow_phone";
        }>>>;
        call_text_scale: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        app_text_size: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
            default: "default";
            small: "small";
            large: "large";
            extra_large: "extra_large";
        }>>>;
        app_lock_enabled: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            device: z.ZodObject<{
                operator_device_id: z.ZodCoercedNumber<unknown>;
                user_id: z.ZodCoercedNumber<unknown>;
                staff_name: z.ZodString;
                staff_email: z.ZodNullable<z.ZodString>;
                staff_role_name: z.ZodNullable<z.ZodString>;
                staff_is_admin: z.ZodBoolean;
                device_id: z.ZodString;
                device_label: z.ZodNullable<z.ZodString>;
                device_model: z.ZodNullable<z.ZodString>;
                os_version: z.ZodNullable<z.ZodString>;
                app_version: z.ZodNullable<z.ZodString>;
                is_native_app: z.ZodBoolean;
                status: z.ZodEnum<{
                    PENDING: "PENDING";
                    ACTIVE: "ACTIVE";
                    SUSPENDED: "SUSPENDED";
                    REVOKED: "REVOKED";
                }>;
                paired_at: z.ZodString;
                last_seen_at: z.ZodNullable<z.ZodString>;
                approved_by: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                approved_at: z.ZodNullable<z.ZodString>;
                revoked_at: z.ZodNullable<z.ZodString>;
                muted: z.ZodBoolean;
                brief_profile_id: z.ZodNullable<z.ZodString>;
                contact_sync_enabled: z.ZodBoolean;
                contact_sync_mode: z.ZodString;
                contacts_synced_at: z.ZodNullable<z.ZodString>;
                contact_count: z.ZodCoercedNumber<unknown>;
                call_logging_scope: z.ZodString;
                calls_logged_count: z.ZodCoercedNumber<unknown>;
                sim_filter: z.ZodNullable<z.ZodString>;
                capabilities: z.ZodRecord<z.ZodString, z.ZodBoolean>;
                effective_capabilities: z.ZodRecord<z.ZodString, z.ZodBoolean>;
                capability_reasons: z.ZodRecord<z.ZodString, z.ZodNullable<z.ZodString>>;
                briefs_synced_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                reported_state: z.ZodNullable<z.ZodObject<{
                    call_screening_role: z.ZodOptional<z.ZodBoolean>;
                    overlay_permission: z.ZodOptional<z.ZodBoolean>;
                    notifications_permission: z.ZodOptional<z.ZodBoolean>;
                    contacts_permission: z.ZodOptional<z.ZodBoolean>;
                    call_log_permission: z.ZodOptional<z.ZodBoolean>;
                    battery_optimization_exempt: z.ZodOptional<z.ZodBoolean>;
                    sim_count: z.ZodOptional<z.ZodNumber>;
                    cached_briefs: z.ZodOptional<z.ZodNumber>;
                    outbox_pending: z.ZodOptional<z.ZodNumber>;
                    last_brief_sync_at: z.ZodOptional<z.ZodString>;
                    last_contact_sync_at: z.ZodOptional<z.ZodString>;
                    call_screen_unsupported: z.ZodOptional<z.ZodBoolean>;
                }, z.core.$loose>>;
                health_warnings: z.ZodArray<z.ZodString>;
                version_status: z.ZodOptional<z.ZodEnum<{
                    unknown: "unknown";
                    up_to_date: "up_to_date";
                    update_available: "update_available";
                    update_required: "update_required";
                }>>;
            }, z.core.$strip>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const SetShopDeviceStatusContract: {
    readonly path: "/phone-assistant/devices/:id/status";
    readonly method: "POST";
    readonly params: z.ZodObject<{
        id: z.ZodCoercedNumber<unknown>;
    }, z.core.$strip>;
    readonly body: z.ZodObject<{
        status: z.ZodEnum<{
            PENDING: "PENDING";
            ACTIVE: "ACTIVE";
            SUSPENDED: "SUSPENDED";
            REVOKED: "REVOKED";
        }>;
        reason: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            device: z.ZodObject<{
                operator_device_id: z.ZodCoercedNumber<unknown>;
                user_id: z.ZodCoercedNumber<unknown>;
                staff_name: z.ZodString;
                staff_email: z.ZodNullable<z.ZodString>;
                staff_role_name: z.ZodNullable<z.ZodString>;
                staff_is_admin: z.ZodBoolean;
                device_id: z.ZodString;
                device_label: z.ZodNullable<z.ZodString>;
                device_model: z.ZodNullable<z.ZodString>;
                os_version: z.ZodNullable<z.ZodString>;
                app_version: z.ZodNullable<z.ZodString>;
                is_native_app: z.ZodBoolean;
                status: z.ZodEnum<{
                    PENDING: "PENDING";
                    ACTIVE: "ACTIVE";
                    SUSPENDED: "SUSPENDED";
                    REVOKED: "REVOKED";
                }>;
                paired_at: z.ZodString;
                last_seen_at: z.ZodNullable<z.ZodString>;
                approved_by: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                approved_at: z.ZodNullable<z.ZodString>;
                revoked_at: z.ZodNullable<z.ZodString>;
                muted: z.ZodBoolean;
                brief_profile_id: z.ZodNullable<z.ZodString>;
                contact_sync_enabled: z.ZodBoolean;
                contact_sync_mode: z.ZodString;
                contacts_synced_at: z.ZodNullable<z.ZodString>;
                contact_count: z.ZodCoercedNumber<unknown>;
                call_logging_scope: z.ZodString;
                calls_logged_count: z.ZodCoercedNumber<unknown>;
                sim_filter: z.ZodNullable<z.ZodString>;
                capabilities: z.ZodRecord<z.ZodString, z.ZodBoolean>;
                effective_capabilities: z.ZodRecord<z.ZodString, z.ZodBoolean>;
                capability_reasons: z.ZodRecord<z.ZodString, z.ZodNullable<z.ZodString>>;
                briefs_synced_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                reported_state: z.ZodNullable<z.ZodObject<{
                    call_screening_role: z.ZodOptional<z.ZodBoolean>;
                    overlay_permission: z.ZodOptional<z.ZodBoolean>;
                    notifications_permission: z.ZodOptional<z.ZodBoolean>;
                    contacts_permission: z.ZodOptional<z.ZodBoolean>;
                    call_log_permission: z.ZodOptional<z.ZodBoolean>;
                    battery_optimization_exempt: z.ZodOptional<z.ZodBoolean>;
                    sim_count: z.ZodOptional<z.ZodNumber>;
                    cached_briefs: z.ZodOptional<z.ZodNumber>;
                    outbox_pending: z.ZodOptional<z.ZodNumber>;
                    last_brief_sync_at: z.ZodOptional<z.ZodString>;
                    last_contact_sync_at: z.ZodOptional<z.ZodString>;
                    call_screen_unsupported: z.ZodOptional<z.ZodBoolean>;
                }, z.core.$loose>>;
                health_warnings: z.ZodArray<z.ZodString>;
                version_status: z.ZodOptional<z.ZodEnum<{
                    unknown: "unknown";
                    up_to_date: "up_to_date";
                    update_available: "update_available";
                    update_required: "update_required";
                }>>;
            }, z.core.$strip>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const WipeShopDeviceContract: {
    readonly path: "/phone-assistant/devices/:id/wipe";
    readonly method: "POST";
    readonly params: z.ZodObject<{
        id: z.ZodCoercedNumber<unknown>;
    }, z.core.$strip>;
    readonly body: z.ZodOptional<z.ZodObject<{
        reason: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            wiped: z.ZodBoolean;
            pushed: z.ZodBoolean;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const TestShopDevicePushContract: {
    readonly path: "/phone-assistant/devices/:id/test-push";
    readonly method: "POST";
    readonly params: z.ZodObject<{
        id: z.ZodCoercedNumber<unknown>;
    }, z.core.$strip>;
    readonly body: z.ZodOptional<z.ZodObject<{}, z.core.$strip>>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            sent: z.ZodBoolean;
            reason: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const DeviceAuditLogItemSchema: z.ZodObject<{
    audit_id: z.ZodCoercedNumber<unknown>;
    operator_device_id: z.ZodCoercedNumber<unknown>;
    actor_user_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
    actor_name: z.ZodNullable<z.ZodString>;
    action: z.ZodString;
    detail: z.ZodNullable<z.ZodUnknown>;
    created_at: z.ZodString;
}, z.core.$strip>;
export type DeviceAuditLogItem = z.infer<typeof DeviceAuditLogItemSchema>;
export declare const GetShopDeviceAuditContract: {
    readonly path: "/phone-assistant/devices/:id/audit";
    readonly method: "GET";
    readonly params: z.ZodObject<{
        id: z.ZodCoercedNumber<unknown>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            logs: z.ZodArray<z.ZodObject<{
                audit_id: z.ZodCoercedNumber<unknown>;
                operator_device_id: z.ZodCoercedNumber<unknown>;
                actor_user_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                actor_name: z.ZodNullable<z.ZodString>;
                action: z.ZodString;
                detail: z.ZodNullable<z.ZodUnknown>;
                created_at: z.ZodString;
            }, z.core.$strip>>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const BriefLockScreenModeEnum: z.ZodEnum<{
    full: "full";
    name_rating: "name_rating";
    name_only: "name_only";
    hidden: "hidden";
}>;
export type BriefLockScreenMode = z.infer<typeof BriefLockScreenModeEnum>;
export declare const BriefAmountModeEnum: z.ZodEnum<{
    exact: "exact";
    hidden: "hidden";
    rounded: "rounded";
    flag_only: "flag_only";
}>;
export type BriefAmountMode = z.infer<typeof BriefAmountModeEnum>;
export declare const BriefProfileSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    fields: z.ZodArray<z.ZodString>;
    lock_screen: z.ZodEnum<{
        full: "full";
        name_rating: "name_rating";
        name_only: "name_only";
        hidden: "hidden";
    }>;
    amounts: z.ZodEnum<{
        exact: "exact";
        hidden: "hidden";
        rounded: "rounded";
        flag_only: "flag_only";
    }>;
    call_screen: z.ZodOptional<z.ZodUnknown>;
}, z.core.$strip>;
export type BriefProfile = z.infer<typeof BriefProfileSchema>;
export declare const OverlayPolicySchema: z.ZodObject<{
    position: z.ZodEnum<{
        top: "top";
        bottom: "bottom";
    }>;
    auto_dismiss_seconds: z.ZodNumber;
    show_for: z.ZodEnum<{
        incoming: "incoming";
        incoming_and_outgoing: "incoming_and_outgoing";
    }>;
}, z.core.$strip>;
export type OverlayPolicy = z.infer<typeof OverlayPolicySchema>;
export declare const UnknownCallerModeEnum: z.ZodEnum<{
    show_not_in_geargrid: "show_not_in_geargrid";
    show_nothing: "show_nothing";
}>;
export type UnknownCallerMode = z.infer<typeof UnknownCallerModeEnum>;
export declare const SharedNumberModeEnum: z.ZodEnum<{
    list_all: "list_all";
    first_only: "first_only";
}>;
export type SharedNumberMode = z.infer<typeof SharedNumberModeEnum>;
export declare const ContactSyncPolicySchema: z.ZodObject<{
    allowed_modes: z.ZodArray<z.ZodEnum<{
        all: "all";
        off: "off";
        selected_labels: "selected_labels";
        selected_accounts: "selected_accounts";
    }>>;
    fields: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type ContactSyncPolicy = z.infer<typeof ContactSyncPolicySchema>;
export declare const CallLoggingPolicySchema: z.ZodObject<{
    allowed_scopes: z.ZodArray<z.ZodEnum<{
        all: "all";
        off: "off";
        customers_only: "customers_only";
        customers_and_contacts: "customers_and_contacts";
    }>>;
    store_unknown_numbers: z.ZodDefault<z.ZodBoolean>;
    business_hours_only: z.ZodDefault<z.ZodBoolean>;
    business_hours: z.ZodOptional<z.ZodObject<{
        from: z.ZodString;
        to: z.ZodString;
    }, z.core.$strip>>;
    retention_days: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export type CallLoggingPolicy = z.infer<typeof CallLoggingPolicySchema>;
export declare const DEFAULT_AFTER_CALL_TAGS: readonly ["Booking", "Payment promise", "Extension", "Complaint", "Price enquiry", "Wrong number"];
export declare const AfterCallCardPolicySchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
    auto_dismiss_seconds: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export type AfterCallCardPolicy = z.infer<typeof AfterCallCardPolicySchema>;
export declare const CallScreenSchema: z.ZodObject<{
    version: z.ZodLiteral<1>;
    size: z.ZodEnum<{
        large: "large";
        extra_large: "extra_large";
        compact: "compact";
        standard: "standard";
    }>;
    text_scale: z.ZodNumber;
    shape: z.ZodObject<{
        width: z.ZodEnum<{
            full: "full";
            inset: "inset";
        }>;
        corner_radius: z.ZodNumber;
        position: z.ZodEnum<{
            top: "top";
            bottom: "bottom";
            middle: "middle";
        }>;
        opacity: z.ZodNumber;
        elevation: z.ZodBoolean;
    }, z.core.$strip>;
    theme: z.ZodObject<{
        mode: z.ZodEnum<{
            auto: "auto";
            light: "light";
            dark: "dark";
        }>;
        accent: z.ZodEnum<{
            brand: "brand";
            neutral: "neutral";
        }>;
        status_bar: z.ZodBoolean;
    }, z.core.$strip>;
    header: z.ZodObject<{
        show_logo: z.ZodBoolean;
        show_shop_name: z.ZodBoolean;
    }, z.core.$strip>;
    rows: z.ZodArray<z.ZodObject<{
        field: z.ZodString;
        style: z.ZodEnum<{
            title: "title";
            emphasis: "emphasis";
            body: "body";
            caption: "caption";
            stars: "stars";
            list: "list";
            chip: "chip";
        }>;
        label: z.ZodOptional<z.ZodBoolean>;
        max_items: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    rules: z.ZodArray<z.ZodObject<{
        when: z.ZodEnum<{
            id_retained: "id_retained";
            status_blacklisted: "status_blacklisted";
            balance_due_over: "balance_due_over";
            overdue_days_over: "overdue_days_over";
            rating_under: "rating_under";
            unknown_caller: "unknown_caller";
        }>;
        value: z.ZodOptional<z.ZodNumber>;
        accent: z.ZodOptional<z.ZodEnum<{
            brand: "brand";
            neutral: "neutral";
            danger: "danger";
            warning: "warning";
        }>>;
        banner: z.ZodOptional<z.ZodBoolean>;
        vibrate: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
    actions: z.ZodArray<z.ZodEnum<{
        dismiss: "dismiss";
        add_note: "add_note";
        open_on_desktop: "open_on_desktop";
        open_app: "open_app";
        call_back_later: "call_back_later";
    }>>;
    behaviour: z.ZodObject<{
        auto_dismiss_seconds: z.ZodNumber;
        draggable: z.ZodBoolean;
        tap_to_expand: z.ZodBoolean;
        show_for: z.ZodEnum<{
            incoming: "incoming";
            incoming_and_outgoing: "incoming_and_outgoing";
        }>;
        collapsed_rows: z.ZodNumber;
    }, z.core.$strip>;
    locked: z.ZodObject<{
        mode: z.ZodEnum<{
            full: "full";
            name_rating: "name_rating";
            name_only: "name_only";
            hidden: "hidden";
        }>;
    }, z.core.$strip>;
}, z.core.$strip>;
export type CallScreen = z.infer<typeof CallScreenSchema>;
export declare const SyncPolicySchema: z.ZodObject<{
    stale_after_minutes: z.ZodNumber;
    warn_after_hours: z.ZodNumber;
    show_sync_footer: z.ZodEnum<{
        never: "never";
        always: "always";
        only_when_stale: "only_when_stale";
    }>;
}, z.core.$strip>;
export declare const CallScreenPolicySchema: z.ZodObject<{
    allow_phone_text_scale: z.ZodBoolean;
    min: z.ZodNumber;
    max: z.ZodNumber;
    respect_system_font: z.ZodBoolean;
}, z.core.$strip>;
export declare const NotificationsLanguagePolicySchema: z.ZodObject<{
    default_language: z.ZodEnum<{
        en: "en";
        si: "si";
        ta: "ta";
        "si-Latn": "si-Latn";
    }>;
    allowed_languages: z.ZodArray<z.ZodEnum<{
        en: "en";
        si: "si";
        ta: "ta";
        "si-Latn": "si-Latn";
    }>>;
    bilingual: z.ZodEnum<{
        off: "off";
        append_english: "append_english";
    }>;
    format: z.ZodObject<{
        currency: z.ZodEnum<{
            LKR: "LKR";
            "Rs.": "Rs.";
            "\u0DBB\u0DD4.": "රු.";
        }>;
        date: z.ZodEnum<{
            "yyyy-mm-dd": "yyyy-mm-dd";
            "dd MMM": "dd MMM";
            "dd/mm": "dd/mm";
        }>;
        time: z.ZodEnum<{
            "24h": "24h";
            "12h": "12h";
        }>;
        digits: z.ZodLiteral<"latin">;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const FullAppPolicySchema: z.ZodObject<{
    enabled: z.ZodBoolean;
    require_app_lock: z.ZodBoolean;
    session_minutes: z.ZodNumber;
    block_screenshots: z.ZodBoolean;
}, z.core.$strip>;
export declare const PhoneAssistantPolicySchema: z.ZodObject<{
    approval_mode: z.ZodEnum<{
        admin_approves_all: "admin_approves_all";
        auto_approve_admin_phones: "auto_approve_admin_phones";
        auto_approve_all: "auto_approve_all";
    }>;
    auto_suspend_days: z.ZodNumber;
    offline_wipe_days: z.ZodNumber;
    capabilities: z.ZodRecord<z.ZodString, z.ZodBoolean>;
    brief_profiles: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        fields: z.ZodArray<z.ZodString>;
        lock_screen: z.ZodEnum<{
            full: "full";
            name_rating: "name_rating";
            name_only: "name_only";
            hidden: "hidden";
        }>;
        amounts: z.ZodEnum<{
            exact: "exact";
            hidden: "hidden";
            rounded: "rounded";
            flag_only: "flag_only";
        }>;
        call_screen: z.ZodOptional<z.ZodUnknown>;
    }, z.core.$strip>>>;
    default_profile_by_role: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    fallback_profile: z.ZodOptional<z.ZodString>;
    cache_scope: z.ZodOptional<z.ZodString>;
    overlay: z.ZodOptional<z.ZodObject<{
        position: z.ZodEnum<{
            top: "top";
            bottom: "bottom";
        }>;
        auto_dismiss_seconds: z.ZodNumber;
        show_for: z.ZodEnum<{
            incoming: "incoming";
            incoming_and_outgoing: "incoming_and_outgoing";
        }>;
    }, z.core.$strip>>;
    unknown_caller: z.ZodOptional<z.ZodEnum<{
        show_not_in_geargrid: "show_not_in_geargrid";
        show_nothing: "show_nothing";
    }>>;
    shared_number: z.ZodOptional<z.ZodEnum<{
        list_all: "list_all";
        first_only: "first_only";
    }>>;
    desktop_popup: z.ZodOptional<z.ZodObject<{
        roles: z.ZodArray<z.ZodCoercedNumber<unknown>>;
        size: z.ZodOptional<z.ZodEnum<{
            large: "large";
            compact: "compact";
            standard: "standard";
        }>>;
    }, z.core.$strip>>;
    sync: z.ZodOptional<z.ZodObject<{
        stale_after_minutes: z.ZodNumber;
        warn_after_hours: z.ZodNumber;
        show_sync_footer: z.ZodEnum<{
            never: "never";
            always: "always";
            only_when_stale: "only_when_stale";
        }>;
    }, z.core.$strip>>;
    call_screen: z.ZodOptional<z.ZodObject<{
        allow_phone_text_scale: z.ZodBoolean;
        min: z.ZodNumber;
        max: z.ZodNumber;
        respect_system_font: z.ZodBoolean;
    }, z.core.$strip>>;
    notifications: z.ZodOptional<z.ZodObject<{
        default_language: z.ZodEnum<{
            en: "en";
            si: "si";
            ta: "ta";
            "si-Latn": "si-Latn";
        }>;
        allowed_languages: z.ZodArray<z.ZodEnum<{
            en: "en";
            si: "si";
            ta: "ta";
            "si-Latn": "si-Latn";
        }>>;
        bilingual: z.ZodEnum<{
            off: "off";
            append_english: "append_english";
        }>;
        format: z.ZodObject<{
            currency: z.ZodEnum<{
                LKR: "LKR";
                "Rs.": "Rs.";
                "\u0DBB\u0DD4.": "රු.";
            }>;
            date: z.ZodEnum<{
                "yyyy-mm-dd": "yyyy-mm-dd";
                "dd MMM": "dd MMM";
                "dd/mm": "dd/mm";
            }>;
            time: z.ZodEnum<{
                "24h": "24h";
                "12h": "12h";
            }>;
            digits: z.ZodLiteral<"latin">;
        }, z.core.$strip>;
    }, z.core.$strip>>;
    full_app: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodBoolean;
        require_app_lock: z.ZodBoolean;
        session_minutes: z.ZodNumber;
        block_screenshots: z.ZodBoolean;
    }, z.core.$strip>>;
    contact_sync: z.ZodOptional<z.ZodObject<{
        allowed_modes: z.ZodArray<z.ZodEnum<{
            all: "all";
            off: "off";
            selected_labels: "selected_labels";
            selected_accounts: "selected_accounts";
        }>>;
        fields: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
    call_logging: z.ZodOptional<z.ZodObject<{
        allowed_scopes: z.ZodArray<z.ZodEnum<{
            all: "all";
            off: "off";
            customers_only: "customers_only";
            customers_and_contacts: "customers_and_contacts";
        }>>;
        store_unknown_numbers: z.ZodDefault<z.ZodBoolean>;
        business_hours_only: z.ZodDefault<z.ZodBoolean>;
        business_hours: z.ZodOptional<z.ZodObject<{
            from: z.ZodString;
            to: z.ZodString;
        }, z.core.$strip>>;
        retention_days: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
    after_call_card: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
        auto_dismiss_seconds: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type PhoneAssistantPolicy = z.infer<typeof PhoneAssistantPolicySchema>;
export declare const GetPhoneAssistantPolicyContract: {
    readonly path: "/phone-assistant/policy";
    readonly method: "GET";
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            policy: z.ZodObject<{
                approval_mode: z.ZodEnum<{
                    admin_approves_all: "admin_approves_all";
                    auto_approve_admin_phones: "auto_approve_admin_phones";
                    auto_approve_all: "auto_approve_all";
                }>;
                auto_suspend_days: z.ZodNumber;
                offline_wipe_days: z.ZodNumber;
                capabilities: z.ZodRecord<z.ZodString, z.ZodBoolean>;
                brief_profiles: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    id: z.ZodString;
                    name: z.ZodString;
                    fields: z.ZodArray<z.ZodString>;
                    lock_screen: z.ZodEnum<{
                        full: "full";
                        name_rating: "name_rating";
                        name_only: "name_only";
                        hidden: "hidden";
                    }>;
                    amounts: z.ZodEnum<{
                        exact: "exact";
                        hidden: "hidden";
                        rounded: "rounded";
                        flag_only: "flag_only";
                    }>;
                    call_screen: z.ZodOptional<z.ZodUnknown>;
                }, z.core.$strip>>>;
                default_profile_by_role: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                fallback_profile: z.ZodOptional<z.ZodString>;
                cache_scope: z.ZodOptional<z.ZodString>;
                overlay: z.ZodOptional<z.ZodObject<{
                    position: z.ZodEnum<{
                        top: "top";
                        bottom: "bottom";
                    }>;
                    auto_dismiss_seconds: z.ZodNumber;
                    show_for: z.ZodEnum<{
                        incoming: "incoming";
                        incoming_and_outgoing: "incoming_and_outgoing";
                    }>;
                }, z.core.$strip>>;
                unknown_caller: z.ZodOptional<z.ZodEnum<{
                    show_not_in_geargrid: "show_not_in_geargrid";
                    show_nothing: "show_nothing";
                }>>;
                shared_number: z.ZodOptional<z.ZodEnum<{
                    list_all: "list_all";
                    first_only: "first_only";
                }>>;
                desktop_popup: z.ZodOptional<z.ZodObject<{
                    roles: z.ZodArray<z.ZodCoercedNumber<unknown>>;
                    size: z.ZodOptional<z.ZodEnum<{
                        large: "large";
                        compact: "compact";
                        standard: "standard";
                    }>>;
                }, z.core.$strip>>;
                sync: z.ZodOptional<z.ZodObject<{
                    stale_after_minutes: z.ZodNumber;
                    warn_after_hours: z.ZodNumber;
                    show_sync_footer: z.ZodEnum<{
                        never: "never";
                        always: "always";
                        only_when_stale: "only_when_stale";
                    }>;
                }, z.core.$strip>>;
                call_screen: z.ZodOptional<z.ZodObject<{
                    allow_phone_text_scale: z.ZodBoolean;
                    min: z.ZodNumber;
                    max: z.ZodNumber;
                    respect_system_font: z.ZodBoolean;
                }, z.core.$strip>>;
                notifications: z.ZodOptional<z.ZodObject<{
                    default_language: z.ZodEnum<{
                        en: "en";
                        si: "si";
                        ta: "ta";
                        "si-Latn": "si-Latn";
                    }>;
                    allowed_languages: z.ZodArray<z.ZodEnum<{
                        en: "en";
                        si: "si";
                        ta: "ta";
                        "si-Latn": "si-Latn";
                    }>>;
                    bilingual: z.ZodEnum<{
                        off: "off";
                        append_english: "append_english";
                    }>;
                    format: z.ZodObject<{
                        currency: z.ZodEnum<{
                            LKR: "LKR";
                            "Rs.": "Rs.";
                            "\u0DBB\u0DD4.": "රු.";
                        }>;
                        date: z.ZodEnum<{
                            "yyyy-mm-dd": "yyyy-mm-dd";
                            "dd MMM": "dd MMM";
                            "dd/mm": "dd/mm";
                        }>;
                        time: z.ZodEnum<{
                            "24h": "24h";
                            "12h": "12h";
                        }>;
                        digits: z.ZodLiteral<"latin">;
                    }, z.core.$strip>;
                }, z.core.$strip>>;
                full_app: z.ZodOptional<z.ZodObject<{
                    enabled: z.ZodBoolean;
                    require_app_lock: z.ZodBoolean;
                    session_minutes: z.ZodNumber;
                    block_screenshots: z.ZodBoolean;
                }, z.core.$strip>>;
                contact_sync: z.ZodOptional<z.ZodObject<{
                    allowed_modes: z.ZodArray<z.ZodEnum<{
                        all: "all";
                        off: "off";
                        selected_labels: "selected_labels";
                        selected_accounts: "selected_accounts";
                    }>>;
                    fields: z.ZodDefault<z.ZodArray<z.ZodString>>;
                }, z.core.$strip>>;
                call_logging: z.ZodOptional<z.ZodObject<{
                    allowed_scopes: z.ZodArray<z.ZodEnum<{
                        all: "all";
                        off: "off";
                        customers_only: "customers_only";
                        customers_and_contacts: "customers_and_contacts";
                    }>>;
                    store_unknown_numbers: z.ZodDefault<z.ZodBoolean>;
                    business_hours_only: z.ZodDefault<z.ZodBoolean>;
                    business_hours: z.ZodOptional<z.ZodObject<{
                        from: z.ZodString;
                        to: z.ZodString;
                    }, z.core.$strip>>;
                    retention_days: z.ZodDefault<z.ZodNumber>;
                }, z.core.$strip>>;
                after_call_card: z.ZodOptional<z.ZodObject<{
                    enabled: z.ZodDefault<z.ZodBoolean>;
                    tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
                    auto_dismiss_seconds: z.ZodDefault<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const UpdatePhoneAssistantPolicyContract: {
    readonly path: "/phone-assistant/policy";
    readonly method: "PUT";
    readonly body: z.ZodObject<{
        approval_mode: z.ZodOptional<z.ZodEnum<{
            admin_approves_all: "admin_approves_all";
            auto_approve_admin_phones: "auto_approve_admin_phones";
            auto_approve_all: "auto_approve_all";
        }>>;
        auto_suspend_days: z.ZodOptional<z.ZodNumber>;
        offline_wipe_days: z.ZodOptional<z.ZodNumber>;
        capabilities: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
        brief_profiles: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
            fields: z.ZodArray<z.ZodString>;
            lock_screen: z.ZodEnum<{
                full: "full";
                name_rating: "name_rating";
                name_only: "name_only";
                hidden: "hidden";
            }>;
            amounts: z.ZodEnum<{
                exact: "exact";
                hidden: "hidden";
                rounded: "rounded";
                flag_only: "flag_only";
            }>;
            call_screen: z.ZodOptional<z.ZodUnknown>;
        }, z.core.$strip>>>>;
        default_profile_by_role: z.ZodOptional<z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>>;
        fallback_profile: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        cache_scope: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        overlay: z.ZodOptional<z.ZodOptional<z.ZodObject<{
            position: z.ZodEnum<{
                top: "top";
                bottom: "bottom";
            }>;
            auto_dismiss_seconds: z.ZodNumber;
            show_for: z.ZodEnum<{
                incoming: "incoming";
                incoming_and_outgoing: "incoming_and_outgoing";
            }>;
        }, z.core.$strip>>>;
        unknown_caller: z.ZodOptional<z.ZodOptional<z.ZodEnum<{
            show_not_in_geargrid: "show_not_in_geargrid";
            show_nothing: "show_nothing";
        }>>>;
        shared_number: z.ZodOptional<z.ZodOptional<z.ZodEnum<{
            list_all: "list_all";
            first_only: "first_only";
        }>>>;
        desktop_popup: z.ZodOptional<z.ZodOptional<z.ZodObject<{
            roles: z.ZodArray<z.ZodCoercedNumber<unknown>>;
            size: z.ZodOptional<z.ZodEnum<{
                large: "large";
                compact: "compact";
                standard: "standard";
            }>>;
        }, z.core.$strip>>>;
        sync: z.ZodOptional<z.ZodOptional<z.ZodObject<{
            stale_after_minutes: z.ZodNumber;
            warn_after_hours: z.ZodNumber;
            show_sync_footer: z.ZodEnum<{
                never: "never";
                always: "always";
                only_when_stale: "only_when_stale";
            }>;
        }, z.core.$strip>>>;
        call_screen: z.ZodOptional<z.ZodOptional<z.ZodObject<{
            allow_phone_text_scale: z.ZodBoolean;
            min: z.ZodNumber;
            max: z.ZodNumber;
            respect_system_font: z.ZodBoolean;
        }, z.core.$strip>>>;
        notifications: z.ZodOptional<z.ZodOptional<z.ZodObject<{
            default_language: z.ZodEnum<{
                en: "en";
                si: "si";
                ta: "ta";
                "si-Latn": "si-Latn";
            }>;
            allowed_languages: z.ZodArray<z.ZodEnum<{
                en: "en";
                si: "si";
                ta: "ta";
                "si-Latn": "si-Latn";
            }>>;
            bilingual: z.ZodEnum<{
                off: "off";
                append_english: "append_english";
            }>;
            format: z.ZodObject<{
                currency: z.ZodEnum<{
                    LKR: "LKR";
                    "Rs.": "Rs.";
                    "\u0DBB\u0DD4.": "රු.";
                }>;
                date: z.ZodEnum<{
                    "yyyy-mm-dd": "yyyy-mm-dd";
                    "dd MMM": "dd MMM";
                    "dd/mm": "dd/mm";
                }>;
                time: z.ZodEnum<{
                    "24h": "24h";
                    "12h": "12h";
                }>;
                digits: z.ZodLiteral<"latin">;
            }, z.core.$strip>;
        }, z.core.$strip>>>;
        full_app: z.ZodOptional<z.ZodOptional<z.ZodObject<{
            enabled: z.ZodBoolean;
            require_app_lock: z.ZodBoolean;
            session_minutes: z.ZodNumber;
            block_screenshots: z.ZodBoolean;
        }, z.core.$strip>>>;
        contact_sync: z.ZodOptional<z.ZodOptional<z.ZodObject<{
            allowed_modes: z.ZodArray<z.ZodEnum<{
                all: "all";
                off: "off";
                selected_labels: "selected_labels";
                selected_accounts: "selected_accounts";
            }>>;
            fields: z.ZodDefault<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>>>;
        call_logging: z.ZodOptional<z.ZodOptional<z.ZodObject<{
            allowed_scopes: z.ZodArray<z.ZodEnum<{
                all: "all";
                off: "off";
                customers_only: "customers_only";
                customers_and_contacts: "customers_and_contacts";
            }>>;
            store_unknown_numbers: z.ZodDefault<z.ZodBoolean>;
            business_hours_only: z.ZodDefault<z.ZodBoolean>;
            business_hours: z.ZodOptional<z.ZodObject<{
                from: z.ZodString;
                to: z.ZodString;
            }, z.core.$strip>>;
            retention_days: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>>>;
        after_call_card: z.ZodOptional<z.ZodOptional<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
            auto_dismiss_seconds: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>>>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            policy: z.ZodObject<{
                approval_mode: z.ZodEnum<{
                    admin_approves_all: "admin_approves_all";
                    auto_approve_admin_phones: "auto_approve_admin_phones";
                    auto_approve_all: "auto_approve_all";
                }>;
                auto_suspend_days: z.ZodNumber;
                offline_wipe_days: z.ZodNumber;
                capabilities: z.ZodRecord<z.ZodString, z.ZodBoolean>;
                brief_profiles: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    id: z.ZodString;
                    name: z.ZodString;
                    fields: z.ZodArray<z.ZodString>;
                    lock_screen: z.ZodEnum<{
                        full: "full";
                        name_rating: "name_rating";
                        name_only: "name_only";
                        hidden: "hidden";
                    }>;
                    amounts: z.ZodEnum<{
                        exact: "exact";
                        hidden: "hidden";
                        rounded: "rounded";
                        flag_only: "flag_only";
                    }>;
                    call_screen: z.ZodOptional<z.ZodUnknown>;
                }, z.core.$strip>>>;
                default_profile_by_role: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                fallback_profile: z.ZodOptional<z.ZodString>;
                cache_scope: z.ZodOptional<z.ZodString>;
                overlay: z.ZodOptional<z.ZodObject<{
                    position: z.ZodEnum<{
                        top: "top";
                        bottom: "bottom";
                    }>;
                    auto_dismiss_seconds: z.ZodNumber;
                    show_for: z.ZodEnum<{
                        incoming: "incoming";
                        incoming_and_outgoing: "incoming_and_outgoing";
                    }>;
                }, z.core.$strip>>;
                unknown_caller: z.ZodOptional<z.ZodEnum<{
                    show_not_in_geargrid: "show_not_in_geargrid";
                    show_nothing: "show_nothing";
                }>>;
                shared_number: z.ZodOptional<z.ZodEnum<{
                    list_all: "list_all";
                    first_only: "first_only";
                }>>;
                desktop_popup: z.ZodOptional<z.ZodObject<{
                    roles: z.ZodArray<z.ZodCoercedNumber<unknown>>;
                    size: z.ZodOptional<z.ZodEnum<{
                        large: "large";
                        compact: "compact";
                        standard: "standard";
                    }>>;
                }, z.core.$strip>>;
                sync: z.ZodOptional<z.ZodObject<{
                    stale_after_minutes: z.ZodNumber;
                    warn_after_hours: z.ZodNumber;
                    show_sync_footer: z.ZodEnum<{
                        never: "never";
                        always: "always";
                        only_when_stale: "only_when_stale";
                    }>;
                }, z.core.$strip>>;
                call_screen: z.ZodOptional<z.ZodObject<{
                    allow_phone_text_scale: z.ZodBoolean;
                    min: z.ZodNumber;
                    max: z.ZodNumber;
                    respect_system_font: z.ZodBoolean;
                }, z.core.$strip>>;
                notifications: z.ZodOptional<z.ZodObject<{
                    default_language: z.ZodEnum<{
                        en: "en";
                        si: "si";
                        ta: "ta";
                        "si-Latn": "si-Latn";
                    }>;
                    allowed_languages: z.ZodArray<z.ZodEnum<{
                        en: "en";
                        si: "si";
                        ta: "ta";
                        "si-Latn": "si-Latn";
                    }>>;
                    bilingual: z.ZodEnum<{
                        off: "off";
                        append_english: "append_english";
                    }>;
                    format: z.ZodObject<{
                        currency: z.ZodEnum<{
                            LKR: "LKR";
                            "Rs.": "Rs.";
                            "\u0DBB\u0DD4.": "රු.";
                        }>;
                        date: z.ZodEnum<{
                            "yyyy-mm-dd": "yyyy-mm-dd";
                            "dd MMM": "dd MMM";
                            "dd/mm": "dd/mm";
                        }>;
                        time: z.ZodEnum<{
                            "24h": "24h";
                            "12h": "12h";
                        }>;
                        digits: z.ZodLiteral<"latin">;
                    }, z.core.$strip>;
                }, z.core.$strip>>;
                full_app: z.ZodOptional<z.ZodObject<{
                    enabled: z.ZodBoolean;
                    require_app_lock: z.ZodBoolean;
                    session_minutes: z.ZodNumber;
                    block_screenshots: z.ZodBoolean;
                }, z.core.$strip>>;
                contact_sync: z.ZodOptional<z.ZodObject<{
                    allowed_modes: z.ZodArray<z.ZodEnum<{
                        all: "all";
                        off: "off";
                        selected_labels: "selected_labels";
                        selected_accounts: "selected_accounts";
                    }>>;
                    fields: z.ZodDefault<z.ZodArray<z.ZodString>>;
                }, z.core.$strip>>;
                call_logging: z.ZodOptional<z.ZodObject<{
                    allowed_scopes: z.ZodArray<z.ZodEnum<{
                        all: "all";
                        off: "off";
                        customers_only: "customers_only";
                        customers_and_contacts: "customers_and_contacts";
                    }>>;
                    store_unknown_numbers: z.ZodDefault<z.ZodBoolean>;
                    business_hours_only: z.ZodDefault<z.ZodBoolean>;
                    business_hours: z.ZodOptional<z.ZodObject<{
                        from: z.ZodString;
                        to: z.ZodString;
                    }, z.core.$strip>>;
                    retention_days: z.ZodDefault<z.ZodNumber>;
                }, z.core.$strip>>;
                after_call_card: z.ZodOptional<z.ZodObject<{
                    enabled: z.ZodDefault<z.ZodBoolean>;
                    tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
                    auto_dismiss_seconds: z.ZodDefault<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const PatchPhoneAssistantPolicyContract: {
    readonly path: "/phone-assistant/policy";
    readonly method: "PATCH";
    readonly body: z.ZodObject<{
        updates: z.ZodArray<z.ZodObject<{
            path: z.ZodString;
            value: z.ZodUnknown;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            policy: z.ZodObject<{
                approval_mode: z.ZodEnum<{
                    admin_approves_all: "admin_approves_all";
                    auto_approve_admin_phones: "auto_approve_admin_phones";
                    auto_approve_all: "auto_approve_all";
                }>;
                auto_suspend_days: z.ZodNumber;
                offline_wipe_days: z.ZodNumber;
                capabilities: z.ZodRecord<z.ZodString, z.ZodBoolean>;
                brief_profiles: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    id: z.ZodString;
                    name: z.ZodString;
                    fields: z.ZodArray<z.ZodString>;
                    lock_screen: z.ZodEnum<{
                        full: "full";
                        name_rating: "name_rating";
                        name_only: "name_only";
                        hidden: "hidden";
                    }>;
                    amounts: z.ZodEnum<{
                        exact: "exact";
                        hidden: "hidden";
                        rounded: "rounded";
                        flag_only: "flag_only";
                    }>;
                    call_screen: z.ZodOptional<z.ZodUnknown>;
                }, z.core.$strip>>>;
                default_profile_by_role: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                fallback_profile: z.ZodOptional<z.ZodString>;
                cache_scope: z.ZodOptional<z.ZodString>;
                overlay: z.ZodOptional<z.ZodObject<{
                    position: z.ZodEnum<{
                        top: "top";
                        bottom: "bottom";
                    }>;
                    auto_dismiss_seconds: z.ZodNumber;
                    show_for: z.ZodEnum<{
                        incoming: "incoming";
                        incoming_and_outgoing: "incoming_and_outgoing";
                    }>;
                }, z.core.$strip>>;
                unknown_caller: z.ZodOptional<z.ZodEnum<{
                    show_not_in_geargrid: "show_not_in_geargrid";
                    show_nothing: "show_nothing";
                }>>;
                shared_number: z.ZodOptional<z.ZodEnum<{
                    list_all: "list_all";
                    first_only: "first_only";
                }>>;
                desktop_popup: z.ZodOptional<z.ZodObject<{
                    roles: z.ZodArray<z.ZodCoercedNumber<unknown>>;
                    size: z.ZodOptional<z.ZodEnum<{
                        large: "large";
                        compact: "compact";
                        standard: "standard";
                    }>>;
                }, z.core.$strip>>;
                sync: z.ZodOptional<z.ZodObject<{
                    stale_after_minutes: z.ZodNumber;
                    warn_after_hours: z.ZodNumber;
                    show_sync_footer: z.ZodEnum<{
                        never: "never";
                        always: "always";
                        only_when_stale: "only_when_stale";
                    }>;
                }, z.core.$strip>>;
                call_screen: z.ZodOptional<z.ZodObject<{
                    allow_phone_text_scale: z.ZodBoolean;
                    min: z.ZodNumber;
                    max: z.ZodNumber;
                    respect_system_font: z.ZodBoolean;
                }, z.core.$strip>>;
                notifications: z.ZodOptional<z.ZodObject<{
                    default_language: z.ZodEnum<{
                        en: "en";
                        si: "si";
                        ta: "ta";
                        "si-Latn": "si-Latn";
                    }>;
                    allowed_languages: z.ZodArray<z.ZodEnum<{
                        en: "en";
                        si: "si";
                        ta: "ta";
                        "si-Latn": "si-Latn";
                    }>>;
                    bilingual: z.ZodEnum<{
                        off: "off";
                        append_english: "append_english";
                    }>;
                    format: z.ZodObject<{
                        currency: z.ZodEnum<{
                            LKR: "LKR";
                            "Rs.": "Rs.";
                            "\u0DBB\u0DD4.": "රු.";
                        }>;
                        date: z.ZodEnum<{
                            "yyyy-mm-dd": "yyyy-mm-dd";
                            "dd MMM": "dd MMM";
                            "dd/mm": "dd/mm";
                        }>;
                        time: z.ZodEnum<{
                            "24h": "24h";
                            "12h": "12h";
                        }>;
                        digits: z.ZodLiteral<"latin">;
                    }, z.core.$strip>;
                }, z.core.$strip>>;
                full_app: z.ZodOptional<z.ZodObject<{
                    enabled: z.ZodBoolean;
                    require_app_lock: z.ZodBoolean;
                    session_minutes: z.ZodNumber;
                    block_screenshots: z.ZodBoolean;
                }, z.core.$strip>>;
                contact_sync: z.ZodOptional<z.ZodObject<{
                    allowed_modes: z.ZodArray<z.ZodEnum<{
                        all: "all";
                        off: "off";
                        selected_labels: "selected_labels";
                        selected_accounts: "selected_accounts";
                    }>>;
                    fields: z.ZodDefault<z.ZodArray<z.ZodString>>;
                }, z.core.$strip>>;
                call_logging: z.ZodOptional<z.ZodObject<{
                    allowed_scopes: z.ZodArray<z.ZodEnum<{
                        all: "all";
                        off: "off";
                        customers_only: "customers_only";
                        customers_and_contacts: "customers_and_contacts";
                    }>>;
                    store_unknown_numbers: z.ZodDefault<z.ZodBoolean>;
                    business_hours_only: z.ZodDefault<z.ZodBoolean>;
                    business_hours: z.ZodOptional<z.ZodObject<{
                        from: z.ZodString;
                        to: z.ZodString;
                    }, z.core.$strip>>;
                    retention_days: z.ZodDefault<z.ZodNumber>;
                }, z.core.$strip>>;
                after_call_card: z.ZodOptional<z.ZodObject<{
                    enabled: z.ZodDefault<z.ZodBoolean>;
                    tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
                    auto_dismiss_seconds: z.ZodDefault<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const DevicePolicyResponseSchema: z.ZodObject<{
    device_status: z.ZodEnum<{
        PENDING: "PENDING";
        ACTIVE: "ACTIVE";
        SUSPENDED: "SUSPENDED";
        REVOKED: "REVOKED";
    }>;
    effective_capabilities: z.ZodRecord<z.ZodString, z.ZodBoolean>;
    capability_reasons: z.ZodRecord<z.ZodString, z.ZodNullable<z.ZodString>>;
    brief_profile: z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        fields: z.ZodArray<z.ZodString>;
        lock_screen: z.ZodEnum<{
            full: "full";
            name_rating: "name_rating";
            name_only: "name_only";
            hidden: "hidden";
        }>;
        amounts: z.ZodEnum<{
            exact: "exact";
            hidden: "hidden";
            rounded: "rounded";
            flag_only: "flag_only";
        }>;
        call_screen: z.ZodOptional<z.ZodUnknown>;
    }, z.core.$strip>;
    cache_scope: z.ZodString;
    overlay: z.ZodObject<{
        position: z.ZodEnum<{
            top: "top";
            bottom: "bottom";
        }>;
        auto_dismiss_seconds: z.ZodNumber;
        show_for: z.ZodEnum<{
            incoming: "incoming";
            incoming_and_outgoing: "incoming_and_outgoing";
        }>;
    }, z.core.$strip>;
    unknown_caller: z.ZodEnum<{
        show_not_in_geargrid: "show_not_in_geargrid";
        show_nothing: "show_nothing";
    }>;
    shared_number: z.ZodEnum<{
        list_all: "list_all";
        first_only: "first_only";
    }>;
    offline_wipe_days: z.ZodNumber;
    contact_sync_mode: z.ZodString;
    call_logging_scope: z.ZodString;
    sim_filter: z.ZodNullable<z.ZodString>;
    muted: z.ZodBoolean;
    contact_sync_policy: z.ZodOptional<z.ZodObject<{
        allowed_modes: z.ZodArray<z.ZodEnum<{
            all: "all";
            off: "off";
            selected_labels: "selected_labels";
            selected_accounts: "selected_accounts";
        }>>;
        fields: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
    call_logging_policy: z.ZodOptional<z.ZodObject<{
        allowed_scopes: z.ZodArray<z.ZodEnum<{
            all: "all";
            off: "off";
            customers_only: "customers_only";
            customers_and_contacts: "customers_and_contacts";
        }>>;
        store_unknown_numbers: z.ZodDefault<z.ZodBoolean>;
        business_hours_only: z.ZodDefault<z.ZodBoolean>;
        business_hours: z.ZodOptional<z.ZodObject<{
            from: z.ZodString;
            to: z.ZodString;
        }, z.core.$strip>>;
        retention_days: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
    contact_count: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    contacts_synced_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    calls_logged_this_month: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    paired_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    consented_capabilities: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
    after_call_card: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
        auto_dismiss_seconds: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
    call_screen: z.ZodOptional<z.ZodObject<{
        version: z.ZodLiteral<1>;
        size: z.ZodEnum<{
            large: "large";
            extra_large: "extra_large";
            compact: "compact";
            standard: "standard";
        }>;
        text_scale: z.ZodNumber;
        shape: z.ZodObject<{
            width: z.ZodEnum<{
                full: "full";
                inset: "inset";
            }>;
            corner_radius: z.ZodNumber;
            position: z.ZodEnum<{
                top: "top";
                bottom: "bottom";
                middle: "middle";
            }>;
            opacity: z.ZodNumber;
            elevation: z.ZodBoolean;
        }, z.core.$strip>;
        theme: z.ZodObject<{
            mode: z.ZodEnum<{
                auto: "auto";
                light: "light";
                dark: "dark";
            }>;
            accent: z.ZodEnum<{
                brand: "brand";
                neutral: "neutral";
            }>;
            status_bar: z.ZodBoolean;
        }, z.core.$strip>;
        header: z.ZodObject<{
            show_logo: z.ZodBoolean;
            show_shop_name: z.ZodBoolean;
        }, z.core.$strip>;
        rows: z.ZodArray<z.ZodObject<{
            field: z.ZodString;
            style: z.ZodEnum<{
                title: "title";
                emphasis: "emphasis";
                body: "body";
                caption: "caption";
                stars: "stars";
                list: "list";
                chip: "chip";
            }>;
            label: z.ZodOptional<z.ZodBoolean>;
            max_items: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
        rules: z.ZodArray<z.ZodObject<{
            when: z.ZodEnum<{
                id_retained: "id_retained";
                status_blacklisted: "status_blacklisted";
                balance_due_over: "balance_due_over";
                overdue_days_over: "overdue_days_over";
                rating_under: "rating_under";
                unknown_caller: "unknown_caller";
            }>;
            value: z.ZodOptional<z.ZodNumber>;
            accent: z.ZodOptional<z.ZodEnum<{
                brand: "brand";
                neutral: "neutral";
                danger: "danger";
                warning: "warning";
            }>>;
            banner: z.ZodOptional<z.ZodBoolean>;
            vibrate: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>>;
        actions: z.ZodArray<z.ZodEnum<{
            dismiss: "dismiss";
            add_note: "add_note";
            open_on_desktop: "open_on_desktop";
            open_app: "open_app";
            call_back_later: "call_back_later";
        }>>;
        behaviour: z.ZodObject<{
            auto_dismiss_seconds: z.ZodNumber;
            draggable: z.ZodBoolean;
            tap_to_expand: z.ZodBoolean;
            show_for: z.ZodEnum<{
                incoming: "incoming";
                incoming_and_outgoing: "incoming_and_outgoing";
            }>;
            collapsed_rows: z.ZodNumber;
        }, z.core.$strip>;
        locked: z.ZodObject<{
            mode: z.ZodEnum<{
                full: "full";
                name_rating: "name_rating";
                name_only: "name_only";
                hidden: "hidden";
            }>;
        }, z.core.$strip>;
    }, z.core.$strip>>;
    sync: z.ZodOptional<z.ZodObject<{
        stale_after_minutes: z.ZodNumber;
        warn_after_hours: z.ZodNumber;
        show_sync_footer: z.ZodEnum<{
            never: "never";
            always: "always";
            only_when_stale: "only_when_stale";
        }>;
    }, z.core.$strip>>;
    notification_languages: z.ZodOptional<z.ZodArray<z.ZodString>>;
    full_app: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodBoolean;
        require_app_lock: z.ZodBoolean;
        session_minutes: z.ZodNumber;
        block_screenshots: z.ZodBoolean;
    }, z.core.$strip>>;
    call_screen_policy: z.ZodOptional<z.ZodObject<{
        allow_phone_text_scale: z.ZodBoolean;
        min: z.ZodNumber;
        max: z.ZodNumber;
        respect_system_font: z.ZodBoolean;
    }, z.core.$strip>>;
    desktop_popup: z.ZodOptional<z.ZodObject<{
        roles: z.ZodArray<z.ZodCoercedNumber<unknown>>;
        size: z.ZodOptional<z.ZodEnum<{
            large: "large";
            compact: "compact";
            standard: "standard";
        }>>;
    }, z.core.$strip>>;
    notification_language: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    app_language: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    call_text_scale: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    app_text_size: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    app_lock_enabled: z.ZodOptional<z.ZodBoolean>;
    locked_by_policy: z.ZodOptional<z.ZodArray<z.ZodString>>;
    min_app_version: z.ZodOptional<z.ZodString>;
    latest_app_version: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type DevicePolicyResponse = z.infer<typeof DevicePolicyResponseSchema>;
export declare const GetDevicePolicyContract: {
    readonly path: "/device/policy";
    readonly method: "GET";
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            device_status: z.ZodEnum<{
                PENDING: "PENDING";
                ACTIVE: "ACTIVE";
                SUSPENDED: "SUSPENDED";
                REVOKED: "REVOKED";
            }>;
            effective_capabilities: z.ZodRecord<z.ZodString, z.ZodBoolean>;
            capability_reasons: z.ZodRecord<z.ZodString, z.ZodNullable<z.ZodString>>;
            brief_profile: z.ZodObject<{
                id: z.ZodString;
                name: z.ZodString;
                fields: z.ZodArray<z.ZodString>;
                lock_screen: z.ZodEnum<{
                    full: "full";
                    name_rating: "name_rating";
                    name_only: "name_only";
                    hidden: "hidden";
                }>;
                amounts: z.ZodEnum<{
                    exact: "exact";
                    hidden: "hidden";
                    rounded: "rounded";
                    flag_only: "flag_only";
                }>;
                call_screen: z.ZodOptional<z.ZodUnknown>;
            }, z.core.$strip>;
            cache_scope: z.ZodString;
            overlay: z.ZodObject<{
                position: z.ZodEnum<{
                    top: "top";
                    bottom: "bottom";
                }>;
                auto_dismiss_seconds: z.ZodNumber;
                show_for: z.ZodEnum<{
                    incoming: "incoming";
                    incoming_and_outgoing: "incoming_and_outgoing";
                }>;
            }, z.core.$strip>;
            unknown_caller: z.ZodEnum<{
                show_not_in_geargrid: "show_not_in_geargrid";
                show_nothing: "show_nothing";
            }>;
            shared_number: z.ZodEnum<{
                list_all: "list_all";
                first_only: "first_only";
            }>;
            offline_wipe_days: z.ZodNumber;
            contact_sync_mode: z.ZodString;
            call_logging_scope: z.ZodString;
            sim_filter: z.ZodNullable<z.ZodString>;
            muted: z.ZodBoolean;
            contact_sync_policy: z.ZodOptional<z.ZodObject<{
                allowed_modes: z.ZodArray<z.ZodEnum<{
                    all: "all";
                    off: "off";
                    selected_labels: "selected_labels";
                    selected_accounts: "selected_accounts";
                }>>;
                fields: z.ZodDefault<z.ZodArray<z.ZodString>>;
            }, z.core.$strip>>;
            call_logging_policy: z.ZodOptional<z.ZodObject<{
                allowed_scopes: z.ZodArray<z.ZodEnum<{
                    all: "all";
                    off: "off";
                    customers_only: "customers_only";
                    customers_and_contacts: "customers_and_contacts";
                }>>;
                store_unknown_numbers: z.ZodDefault<z.ZodBoolean>;
                business_hours_only: z.ZodDefault<z.ZodBoolean>;
                business_hours: z.ZodOptional<z.ZodObject<{
                    from: z.ZodString;
                    to: z.ZodString;
                }, z.core.$strip>>;
                retention_days: z.ZodDefault<z.ZodNumber>;
            }, z.core.$strip>>;
            contact_count: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
            contacts_synced_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            calls_logged_this_month: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
            paired_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            consented_capabilities: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
            after_call_card: z.ZodOptional<z.ZodObject<{
                enabled: z.ZodDefault<z.ZodBoolean>;
                tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
                auto_dismiss_seconds: z.ZodDefault<z.ZodNumber>;
            }, z.core.$strip>>;
            call_screen: z.ZodOptional<z.ZodObject<{
                version: z.ZodLiteral<1>;
                size: z.ZodEnum<{
                    large: "large";
                    extra_large: "extra_large";
                    compact: "compact";
                    standard: "standard";
                }>;
                text_scale: z.ZodNumber;
                shape: z.ZodObject<{
                    width: z.ZodEnum<{
                        full: "full";
                        inset: "inset";
                    }>;
                    corner_radius: z.ZodNumber;
                    position: z.ZodEnum<{
                        top: "top";
                        bottom: "bottom";
                        middle: "middle";
                    }>;
                    opacity: z.ZodNumber;
                    elevation: z.ZodBoolean;
                }, z.core.$strip>;
                theme: z.ZodObject<{
                    mode: z.ZodEnum<{
                        auto: "auto";
                        light: "light";
                        dark: "dark";
                    }>;
                    accent: z.ZodEnum<{
                        brand: "brand";
                        neutral: "neutral";
                    }>;
                    status_bar: z.ZodBoolean;
                }, z.core.$strip>;
                header: z.ZodObject<{
                    show_logo: z.ZodBoolean;
                    show_shop_name: z.ZodBoolean;
                }, z.core.$strip>;
                rows: z.ZodArray<z.ZodObject<{
                    field: z.ZodString;
                    style: z.ZodEnum<{
                        title: "title";
                        emphasis: "emphasis";
                        body: "body";
                        caption: "caption";
                        stars: "stars";
                        list: "list";
                        chip: "chip";
                    }>;
                    label: z.ZodOptional<z.ZodBoolean>;
                    max_items: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strip>>;
                rules: z.ZodArray<z.ZodObject<{
                    when: z.ZodEnum<{
                        id_retained: "id_retained";
                        status_blacklisted: "status_blacklisted";
                        balance_due_over: "balance_due_over";
                        overdue_days_over: "overdue_days_over";
                        rating_under: "rating_under";
                        unknown_caller: "unknown_caller";
                    }>;
                    value: z.ZodOptional<z.ZodNumber>;
                    accent: z.ZodOptional<z.ZodEnum<{
                        brand: "brand";
                        neutral: "neutral";
                        danger: "danger";
                        warning: "warning";
                    }>>;
                    banner: z.ZodOptional<z.ZodBoolean>;
                    vibrate: z.ZodOptional<z.ZodBoolean>;
                }, z.core.$strip>>;
                actions: z.ZodArray<z.ZodEnum<{
                    dismiss: "dismiss";
                    add_note: "add_note";
                    open_on_desktop: "open_on_desktop";
                    open_app: "open_app";
                    call_back_later: "call_back_later";
                }>>;
                behaviour: z.ZodObject<{
                    auto_dismiss_seconds: z.ZodNumber;
                    draggable: z.ZodBoolean;
                    tap_to_expand: z.ZodBoolean;
                    show_for: z.ZodEnum<{
                        incoming: "incoming";
                        incoming_and_outgoing: "incoming_and_outgoing";
                    }>;
                    collapsed_rows: z.ZodNumber;
                }, z.core.$strip>;
                locked: z.ZodObject<{
                    mode: z.ZodEnum<{
                        full: "full";
                        name_rating: "name_rating";
                        name_only: "name_only";
                        hidden: "hidden";
                    }>;
                }, z.core.$strip>;
            }, z.core.$strip>>;
            sync: z.ZodOptional<z.ZodObject<{
                stale_after_minutes: z.ZodNumber;
                warn_after_hours: z.ZodNumber;
                show_sync_footer: z.ZodEnum<{
                    never: "never";
                    always: "always";
                    only_when_stale: "only_when_stale";
                }>;
            }, z.core.$strip>>;
            notification_languages: z.ZodOptional<z.ZodArray<z.ZodString>>;
            full_app: z.ZodOptional<z.ZodObject<{
                enabled: z.ZodBoolean;
                require_app_lock: z.ZodBoolean;
                session_minutes: z.ZodNumber;
                block_screenshots: z.ZodBoolean;
            }, z.core.$strip>>;
            call_screen_policy: z.ZodOptional<z.ZodObject<{
                allow_phone_text_scale: z.ZodBoolean;
                min: z.ZodNumber;
                max: z.ZodNumber;
                respect_system_font: z.ZodBoolean;
            }, z.core.$strip>>;
            desktop_popup: z.ZodOptional<z.ZodObject<{
                roles: z.ZodArray<z.ZodCoercedNumber<unknown>>;
                size: z.ZodOptional<z.ZodEnum<{
                    large: "large";
                    compact: "compact";
                    standard: "standard";
                }>>;
            }, z.core.$strip>>;
            notification_language: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            app_language: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            call_text_scale: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            app_text_size: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            app_lock_enabled: z.ZodOptional<z.ZodBoolean>;
            locked_by_policy: z.ZodOptional<z.ZodArray<z.ZodString>>;
            min_app_version: z.ZodOptional<z.ZodString>;
            latest_app_version: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const UpdateDeviceSettingsContract: {
    readonly path: "/device/settings";
    readonly method: "PUT";
    readonly body: z.ZodObject<{
        muted: z.ZodOptional<z.ZodBoolean>;
        contact_sync_mode: z.ZodOptional<z.ZodEnum<{
            all: "all";
            off: "off";
            selected_labels: "selected_labels";
            selected_accounts: "selected_accounts";
        }>>;
        call_logging_scope: z.ZodOptional<z.ZodEnum<{
            all: "all";
            off: "off";
            customers_only: "customers_only";
            customers_and_contacts: "customers_and_contacts";
        }>>;
        sim_filter: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        notification_language: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
            en: "en";
            si: "si";
            ta: "ta";
            "si-Latn": "si-Latn";
        }>>>;
        app_language: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
            en: "en";
            si: "si";
            ta: "ta";
        }>>>;
        call_text_scale: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        app_text_size: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
            default: "default";
            small: "small";
            large: "large";
            extra_large: "extra_large";
        }>>>;
        app_lock_enabled: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            muted: z.ZodBoolean;
            contact_sync_mode: z.ZodString;
            call_logging_scope: z.ZodString;
            sim_filter: z.ZodNullable<z.ZodString>;
            effective_capabilities: z.ZodRecord<z.ZodString, z.ZodBoolean>;
            capability_reasons: z.ZodRecord<z.ZodString, z.ZodNullable<z.ZodString>>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const DeleteDeviceContactsContract: {
    readonly path: "/device/contacts";
    readonly method: "DELETE";
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            deleted: z.ZodCoercedNumber<unknown>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const DeleteDeviceCallsContract: {
    readonly path: "/device/calls";
    readonly method: "DELETE";
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            deleted: z.ZodCoercedNumber<unknown>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const PostDeviceCallNoteContract: {
    readonly path: "/device/calls/:client_call_id/note";
    readonly method: "POST";
    readonly params: z.ZodObject<{
        client_call_id: z.ZodString;
    }, z.core.$strip>;
    readonly body: z.ZodObject<{
        tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
        note: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        follow_up_on: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            note: z.ZodObject<{
                note_id: z.ZodCoercedNumber<unknown>;
                call_id: z.ZodCoercedNumber<unknown>;
                customer_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                contact_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                tags: z.ZodArray<z.ZodString>;
                note: z.ZodNullable<z.ZodString>;
                follow_up_on: z.ZodNullable<z.ZodString>;
                follow_up_done_at: z.ZodNullable<z.ZodString>;
                created_by_user_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                author_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                created_at: z.ZodString;
            }, z.core.$strip>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const PostStaffCallNoteContract: {
    readonly path: "/calls/:id/note";
    readonly method: "POST";
    readonly params: z.ZodObject<{
        id: z.ZodCoercedNumber<unknown>;
    }, z.core.$strip>;
    readonly body: z.ZodObject<{
        tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
        note: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        follow_up_on: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            note: z.ZodObject<{
                note_id: z.ZodCoercedNumber<unknown>;
                call_id: z.ZodCoercedNumber<unknown>;
                customer_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                contact_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                tags: z.ZodArray<z.ZodString>;
                note: z.ZodNullable<z.ZodString>;
                follow_up_on: z.ZodNullable<z.ZodString>;
                follow_up_done_at: z.ZodNullable<z.ZodString>;
                created_by_user_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                author_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                created_at: z.ZodString;
            }, z.core.$strip>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const ListMissedCallsContract: {
    readonly path: "/calls/missed";
    readonly method: "GET";
    readonly query: z.ZodObject<{
        limit: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            items: z.ZodArray<z.ZodObject<{
                call_id: z.ZodCoercedNumber<unknown>;
                operator_device_id: z.ZodCoercedNumber<unknown>;
                client_call_id: z.ZodString;
                phone_e164: z.ZodNullable<z.ZodString>;
                raw_number: z.ZodNullable<z.ZodString>;
                direction: z.ZodEnum<{
                    INCOMING: "INCOMING";
                    OUTGOING: "OUTGOING";
                    MISSED: "MISSED";
                }>;
                customer_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                contact_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                started_at: z.ZodString;
                ended_at: z.ZodNullable<z.ZodString>;
                duration_seconds: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                device_label: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                sim_label: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                number_masked: z.ZodOptional<z.ZodBoolean>;
                callback_handled_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                notes: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    note_id: z.ZodCoercedNumber<unknown>;
                    call_id: z.ZodCoercedNumber<unknown>;
                    customer_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                    contact_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                    tags: z.ZodArray<z.ZodString>;
                    note: z.ZodNullable<z.ZodString>;
                    follow_up_on: z.ZodNullable<z.ZodString>;
                    follow_up_done_at: z.ZodNullable<z.ZodString>;
                    created_by_user_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                    author_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    created_at: z.ZodString;
                }, z.core.$strip>>>;
                customer_name: z.ZodNullable<z.ZodString>;
                contact_name: z.ZodNullable<z.ZodString>;
                brief: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                    customer_id: z.ZodCoercedNumber<unknown>;
                    display_name: z.ZodString;
                    company_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    parent_company: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    phones: z.ZodArray<z.ZodString>;
                    rating: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                    status: z.ZodString;
                    blacklist_reason: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    balance_due: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
                    deposit_balance: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
                    has_dues: z.ZodOptional<z.ZodBoolean>;
                    id_retained: z.ZodOptional<z.ZodBoolean>;
                    active_items: z.ZodOptional<z.ZodArray<z.ZodObject<{
                        name: z.ZodString;
                        qty: z.ZodCoercedNumber<unknown>;
                        due: z.ZodNullable<z.ZodString>;
                        overdue_days: z.ZodCoercedNumber<unknown>;
                    }, z.core.$strip>>>;
                    overdue_count: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
                    max_overdue_days: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
                    invoice_count: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
                    first_rental: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    last_rental: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    last_payment: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                        amount: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
                        date: z.ZodNullable<z.ZodString>;
                        method: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>>;
                    last_review_comment: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    recent_call_notes: z.ZodOptional<z.ZodArray<z.ZodObject<{
                        note_id: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
                        outcome: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                        note_text: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                        follow_up_on: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                        author_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                        created_at: z.ZodOptional<z.ZodString>;
                    }, z.core.$strip>>>;
                    summary_line: z.ZodString;
                    earliest_overdue_due: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    updated_at: z.ZodString;
                }, z.core.$strip>>>;
            }, z.core.$strip>>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const ListDeviceMissedCallsContract: {
    readonly path: "/device/calls/missed";
    readonly method: "GET";
    readonly query: z.ZodObject<{
        limit: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            items: z.ZodArray<z.ZodObject<{
                call_id: z.ZodCoercedNumber<unknown>;
                operator_device_id: z.ZodCoercedNumber<unknown>;
                client_call_id: z.ZodString;
                phone_e164: z.ZodNullable<z.ZodString>;
                raw_number: z.ZodNullable<z.ZodString>;
                direction: z.ZodEnum<{
                    INCOMING: "INCOMING";
                    OUTGOING: "OUTGOING";
                    MISSED: "MISSED";
                }>;
                customer_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                contact_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                started_at: z.ZodString;
                ended_at: z.ZodNullable<z.ZodString>;
                duration_seconds: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                device_label: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                sim_label: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                number_masked: z.ZodOptional<z.ZodBoolean>;
                callback_handled_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                notes: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    note_id: z.ZodCoercedNumber<unknown>;
                    call_id: z.ZodCoercedNumber<unknown>;
                    customer_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                    contact_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                    tags: z.ZodArray<z.ZodString>;
                    note: z.ZodNullable<z.ZodString>;
                    follow_up_on: z.ZodNullable<z.ZodString>;
                    follow_up_done_at: z.ZodNullable<z.ZodString>;
                    created_by_user_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                    author_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    created_at: z.ZodString;
                }, z.core.$strip>>>;
                customer_name: z.ZodNullable<z.ZodString>;
                contact_name: z.ZodNullable<z.ZodString>;
                brief: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                    customer_id: z.ZodCoercedNumber<unknown>;
                    display_name: z.ZodString;
                    company_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    parent_company: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    phones: z.ZodArray<z.ZodString>;
                    rating: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                    status: z.ZodString;
                    blacklist_reason: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    balance_due: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
                    deposit_balance: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
                    has_dues: z.ZodOptional<z.ZodBoolean>;
                    id_retained: z.ZodOptional<z.ZodBoolean>;
                    active_items: z.ZodOptional<z.ZodArray<z.ZodObject<{
                        name: z.ZodString;
                        qty: z.ZodCoercedNumber<unknown>;
                        due: z.ZodNullable<z.ZodString>;
                        overdue_days: z.ZodCoercedNumber<unknown>;
                    }, z.core.$strip>>>;
                    overdue_count: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
                    max_overdue_days: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
                    invoice_count: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
                    first_rental: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    last_rental: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    last_payment: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                        amount: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
                        date: z.ZodNullable<z.ZodString>;
                        method: z.ZodNullable<z.ZodString>;
                    }, z.core.$strip>>>;
                    last_review_comment: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    recent_call_notes: z.ZodOptional<z.ZodArray<z.ZodObject<{
                        note_id: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
                        outcome: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                        note_text: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                        follow_up_on: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                        author_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                        created_at: z.ZodOptional<z.ZodString>;
                    }, z.core.$strip>>>;
                    summary_line: z.ZodString;
                    earliest_overdue_due: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    updated_at: z.ZodString;
                }, z.core.$strip>>>;
            }, z.core.$strip>>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const MarkCallHandledContract: {
    readonly path: "/calls/:id/handled";
    readonly method: "POST";
    readonly params: z.ZodObject<{
        id: z.ZodCoercedNumber<unknown>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            call_id: z.ZodCoercedNumber<unknown>;
            callback_handled_at: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const MarkDeviceCallHandledContract: {
    readonly path: "/device/calls/:id/handled";
    readonly method: "POST";
    readonly params: z.ZodObject<{
        id: z.ZodCoercedNumber<unknown>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            call_id: z.ZodCoercedNumber<unknown>;
            callback_handled_at: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const ListFollowUpsContract: {
    readonly path: "/follow-ups";
    readonly method: "GET";
    readonly query: z.ZodObject<{
        status: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
            pending: "pending";
            done: "done";
            all: "all";
        }>>>;
        customer_id: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
        limit: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            items: z.ZodArray<z.ZodObject<{
                note_id: z.ZodCoercedNumber<unknown>;
                call_id: z.ZodCoercedNumber<unknown>;
                customer_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                contact_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                tags: z.ZodArray<z.ZodString>;
                note: z.ZodNullable<z.ZodString>;
                follow_up_on: z.ZodNullable<z.ZodString>;
                follow_up_done_at: z.ZodNullable<z.ZodString>;
                created_by_user_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                author_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                created_at: z.ZodString;
                customer_name: z.ZodNullable<z.ZodString>;
                contact_name: z.ZodNullable<z.ZodString>;
                phone_e164: z.ZodNullable<z.ZodString>;
                raw_number: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const ListDeviceFollowUpsContract: {
    readonly path: "/device/follow-ups";
    readonly method: "GET";
    readonly query: z.ZodObject<{
        status: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
            pending: "pending";
            done: "done";
            all: "all";
        }>>>;
        customer_id: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
        limit: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            items: z.ZodArray<z.ZodObject<{
                note_id: z.ZodCoercedNumber<unknown>;
                call_id: z.ZodCoercedNumber<unknown>;
                customer_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                contact_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                tags: z.ZodArray<z.ZodString>;
                note: z.ZodNullable<z.ZodString>;
                follow_up_on: z.ZodNullable<z.ZodString>;
                follow_up_done_at: z.ZodNullable<z.ZodString>;
                created_by_user_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                author_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                created_at: z.ZodString;
                customer_name: z.ZodNullable<z.ZodString>;
                contact_name: z.ZodNullable<z.ZodString>;
                phone_e164: z.ZodNullable<z.ZodString>;
                raw_number: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const UpdateFollowUpContract: {
    readonly path: "/follow-ups/:id";
    readonly method: "PATCH";
    readonly params: z.ZodObject<{
        id: z.ZodCoercedNumber<unknown>;
    }, z.core.$strip>;
    readonly body: z.ZodObject<{
        done: z.ZodOptional<z.ZodBoolean>;
        snooze_to: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            follow_up: z.ZodObject<{
                note_id: z.ZodCoercedNumber<unknown>;
                call_id: z.ZodCoercedNumber<unknown>;
                customer_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                contact_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                tags: z.ZodArray<z.ZodString>;
                note: z.ZodNullable<z.ZodString>;
                follow_up_on: z.ZodNullable<z.ZodString>;
                follow_up_done_at: z.ZodNullable<z.ZodString>;
                created_by_user_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                author_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                created_at: z.ZodString;
                customer_name: z.ZodNullable<z.ZodString>;
                contact_name: z.ZodNullable<z.ZodString>;
                phone_e164: z.ZodNullable<z.ZodString>;
                raw_number: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const UpdateDeviceFollowUpContract: {
    readonly path: "/device/follow-ups/:id";
    readonly method: "PATCH";
    readonly params: z.ZodObject<{
        id: z.ZodCoercedNumber<unknown>;
    }, z.core.$strip>;
    readonly body: z.ZodObject<{
        done: z.ZodOptional<z.ZodBoolean>;
        snooze_to: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            follow_up: z.ZodObject<{
                note_id: z.ZodCoercedNumber<unknown>;
                call_id: z.ZodCoercedNumber<unknown>;
                customer_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                contact_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                tags: z.ZodArray<z.ZodString>;
                note: z.ZodNullable<z.ZodString>;
                follow_up_on: z.ZodNullable<z.ZodString>;
                follow_up_done_at: z.ZodNullable<z.ZodString>;
                created_by_user_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                author_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                created_at: z.ZodString;
                customer_name: z.ZodNullable<z.ZodString>;
                contact_name: z.ZodNullable<z.ZodString>;
                phone_e164: z.ZodNullable<z.ZodString>;
                raw_number: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const DialCallBodySchema: z.ZodObject<{
    phone: z.ZodString;
}, z.core.$strip>;
export type DialCallBody = z.infer<typeof DialCallBodySchema>;
export declare const DialCallResponseSchema: z.ZodObject<{
    sent: z.ZodCoercedNumber<unknown>;
    total_devices: z.ZodCoercedNumber<unknown>;
    phone: z.ZodString;
}, z.core.$strip>;
export type DialCallResponse = z.infer<typeof DialCallResponseSchema>;
export declare const DialCallContract: {
    readonly path: "/calls/dial";
    readonly method: "POST";
    readonly body: z.ZodObject<{
        phone: z.ZodString;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            sent: z.ZodCoercedNumber<unknown>;
            total_devices: z.ZodCoercedNumber<unknown>;
            phone: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const PostDeviceOpenCustomerBodySchema: z.ZodObject<{
    customer_id: z.ZodCoercedNumber<unknown>;
    call_id: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodCoercedNumber<unknown>, z.ZodString]>>>;
}, z.core.$strip>;
export type PostDeviceOpenCustomerBody = z.infer<typeof PostDeviceOpenCustomerBodySchema>;
export declare const PostDeviceOpenCustomerResponseSchema: z.ZodObject<{
    emitted: z.ZodBoolean;
    customer_id: z.ZodCoercedNumber<unknown>;
}, z.core.$strip>;
export type PostDeviceOpenCustomerResponse = z.infer<typeof PostDeviceOpenCustomerResponseSchema>;
export declare const PostDeviceOpenCustomerContract: {
    readonly path: "/device/pos/open-customer";
    readonly method: "POST";
    readonly body: z.ZodObject<{
        customer_id: z.ZodCoercedNumber<unknown>;
        call_id: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodCoercedNumber<unknown>, z.ZodString]>>>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            emitted: z.ZodBoolean;
            customer_id: z.ZodCoercedNumber<unknown>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const CreateLeadContactBodySchema: z.ZodObject<{
    display_name: z.ZodString;
    phone: z.ZodString;
    note: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    call_id: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodCoercedNumber<unknown>, z.ZodString]>>>;
}, z.core.$strip>;
export type CreateLeadContactBody = z.infer<typeof CreateLeadContactBodySchema>;
export declare const LeadContactItemSchema: z.ZodObject<{
    contact_id: z.ZodCoercedNumber<unknown>;
    display_name: z.ZodString;
    phone_e164: z.ZodString;
    raw_phone: z.ZodNullable<z.ZodString>;
    source: z.ZodLiteral<"lead">;
    notes: z.ZodNullable<z.ZodString>;
    created_by_user_id: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
}, z.core.$strip>;
export type LeadContactItem = z.infer<typeof LeadContactItemSchema>;
export declare const CreateLeadContactContract: {
    readonly path: "/phone-contacts/leads";
    readonly method: "POST";
    readonly body: z.ZodObject<{
        display_name: z.ZodString;
        phone: z.ZodString;
        note: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        call_id: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodCoercedNumber<unknown>, z.ZodString]>>>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            lead: z.ZodObject<{
                contact_id: z.ZodCoercedNumber<unknown>;
                display_name: z.ZodString;
                phone_e164: z.ZodString;
                raw_phone: z.ZodNullable<z.ZodString>;
                source: z.ZodLiteral<"lead">;
                notes: z.ZodNullable<z.ZodString>;
                created_by_user_id: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
            }, z.core.$strip>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const CreateDeviceLeadContactContract: {
    readonly path: "/device/leads";
    readonly method: "POST";
    readonly body: z.ZodObject<{
        display_name: z.ZodString;
        phone: z.ZodString;
        note: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        call_id: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodCoercedNumber<unknown>, z.ZodString]>>>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            lead: z.ZodObject<{
                contact_id: z.ZodCoercedNumber<unknown>;
                display_name: z.ZodString;
                phone_e164: z.ZodString;
                raw_phone: z.ZodNullable<z.ZodString>;
                source: z.ZodLiteral<"lead">;
                notes: z.ZodNullable<z.ZodString>;
                created_by_user_id: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
            }, z.core.$strip>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const PushTemplateSchema: z.ZodObject<{
    event_key: z.ZodString;
    language: z.ZodEnum<{
        en: "en";
        si: "si";
        ta: "ta";
        "si-Latn": "si-Latn";
    }>;
    title: z.ZodString;
    body: z.ZodString;
    title_private: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    body_private: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    edited: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export type PushTemplate = z.infer<typeof PushTemplateSchema>;
export declare const GetPushTemplatesContract: {
    readonly path: "/phone-assistant/templates";
    readonly method: "GET";
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            templates: z.ZodArray<z.ZodObject<{
                event_key: z.ZodString;
                language: z.ZodEnum<{
                    en: "en";
                    si: "si";
                    ta: "ta";
                    "si-Latn": "si-Latn";
                }>;
                title: z.ZodString;
                body: z.ZodString;
                title_private: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                body_private: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                edited: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strip>>;
            languages: z.ZodArray<z.ZodString>;
            events: z.ZodArray<z.ZodObject<{
                key: z.ZodString;
                placeholders: z.ZodArray<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const PutPushTemplateContract: {
    readonly path: "/phone-assistant/templates/:event_key/:language";
    readonly method: "PUT";
    readonly params: z.ZodObject<{
        event_key: z.ZodString;
        language: z.ZodEnum<{
            en: "en";
            si: "si";
            ta: "ta";
            "si-Latn": "si-Latn";
        }>;
    }, z.core.$strip>;
    readonly body: z.ZodObject<{
        title: z.ZodString;
        body: z.ZodString;
        title_private: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        body_private: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            template: z.ZodObject<{
                event_key: z.ZodString;
                language: z.ZodEnum<{
                    en: "en";
                    si: "si";
                    ta: "ta";
                    "si-Latn": "si-Latn";
                }>;
                title: z.ZodString;
                body: z.ZodString;
                title_private: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                body_private: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                edited: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strip>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const DeletePushTemplateContract: {
    readonly path: "/phone-assistant/templates/:event_key/:language";
    readonly method: "DELETE";
    readonly params: z.ZodObject<{
        event_key: z.ZodString;
        language: z.ZodEnum<{
            en: "en";
            si: "si";
            ta: "ta";
            "si-Latn": "si-Latn";
        }>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            restored: z.ZodBoolean;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const PreviewPushTemplateContract: {
    readonly path: "/phone-assistant/templates/preview";
    readonly method: "POST";
    readonly body: z.ZodObject<{
        event_key: z.ZodString;
        language: z.ZodEnum<{
            en: "en";
            si: "si";
            ta: "ta";
            "si-Latn": "si-Latn";
        }>;
        title: z.ZodString;
        body: z.ZodString;
        title_private: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        body_private: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            normal: z.ZodObject<{
                title: z.ZodString;
                body: z.ZodString;
            }, z.core.$strip>;
            private: z.ZodObject<{
                title: z.ZodString;
                body: z.ZodString;
            }, z.core.$strip>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const SendCallScreenSampleContract: {
    readonly path: "/phone-assistant/call-screen/sample";
    readonly method: "POST";
    readonly body: z.ZodOptional<z.ZodObject<{
        profile_id: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            reached: z.ZodCoercedNumber<unknown>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const SendPushTemplateTestContract: {
    readonly path: "/phone-assistant/templates/test";
    readonly method: "POST";
    readonly body: z.ZodObject<{
        event_key: z.ZodString;
        language: z.ZodEnum<{
            en: "en";
            si: "si";
            ta: "ta";
            "si-Latn": "si-Latn";
        }>;
        title: z.ZodString;
        body: z.ZodString;
        title_private: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        body_private: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        private: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            reached: z.ZodCoercedNumber<unknown>;
            title: z.ZodString;
            body: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
//# sourceMappingURL=phoneAssistant.d.ts.map