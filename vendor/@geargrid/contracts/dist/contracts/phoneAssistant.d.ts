import { z } from "zod";
export declare const ActiveBriefItemSchema: z.ZodObject<{
    name: z.ZodString;
    qty: z.ZodCoercedNumber<unknown>;
    due: z.ZodNullable<z.ZodString>;
    overdue_days: z.ZodCoercedNumber<unknown>;
}, z.core.$strip>;
export declare const CustomerBriefSchema: z.ZodObject<{
    customer_id: z.ZodCoercedNumber<unknown>;
    display_name: z.ZodString;
    company_name: z.ZodNullable<z.ZodString>;
    parent_company: z.ZodNullable<z.ZodString>;
    phones: z.ZodArray<z.ZodString>;
    rating: z.ZodNullable<z.ZodNumber>;
    status: z.ZodString;
    balance_due: z.ZodCoercedNumber<unknown>;
    deposit_balance: z.ZodCoercedNumber<unknown>;
    id_retained: z.ZodBoolean;
    active_items: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        qty: z.ZodCoercedNumber<unknown>;
        due: z.ZodNullable<z.ZodString>;
        overdue_days: z.ZodCoercedNumber<unknown>;
    }, z.core.$strip>>;
    invoice_count: z.ZodCoercedNumber<unknown>;
    first_rental: z.ZodNullable<z.ZodString>;
    last_rental: z.ZodNullable<z.ZodString>;
    last_payment: z.ZodNullable<z.ZodObject<{
        amount: z.ZodCoercedNumber<unknown>;
        date: z.ZodNullable<z.ZodString>;
        method: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    last_review_comment: z.ZodNullable<z.ZodString>;
    summary_line: z.ZodString;
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
export declare const RegisterDeviceContract: {
    readonly path: "/device/register";
    readonly method: "POST";
    readonly body: z.ZodObject<{
        app_version: z.ZodString;
        push_token: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        contact_sync_enabled: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            is_admin: z.ZodBoolean;
            contact_sync_enabled: z.ZodBoolean;
            features: z.ZodObject<{
                phone_assistant: z.ZodBoolean;
            }, z.core.$catchall<z.ZodBoolean>>;
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
                company_name: z.ZodNullable<z.ZodString>;
                parent_company: z.ZodNullable<z.ZodString>;
                phones: z.ZodArray<z.ZodString>;
                rating: z.ZodNullable<z.ZodNumber>;
                status: z.ZodString;
                balance_due: z.ZodCoercedNumber<unknown>;
                deposit_balance: z.ZodCoercedNumber<unknown>;
                id_retained: z.ZodBoolean;
                active_items: z.ZodArray<z.ZodObject<{
                    name: z.ZodString;
                    qty: z.ZodCoercedNumber<unknown>;
                    due: z.ZodNullable<z.ZodString>;
                    overdue_days: z.ZodCoercedNumber<unknown>;
                }, z.core.$strip>>;
                invoice_count: z.ZodCoercedNumber<unknown>;
                first_rental: z.ZodNullable<z.ZodString>;
                last_rental: z.ZodNullable<z.ZodString>;
                last_payment: z.ZodNullable<z.ZodObject<{
                    amount: z.ZodCoercedNumber<unknown>;
                    date: z.ZodNullable<z.ZodString>;
                    method: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
                last_review_comment: z.ZodNullable<z.ZodString>;
                summary_line: z.ZodString;
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
                company_name: z.ZodNullable<z.ZodString>;
                parent_company: z.ZodNullable<z.ZodString>;
                phones: z.ZodArray<z.ZodString>;
                rating: z.ZodNullable<z.ZodNumber>;
                status: z.ZodString;
                balance_due: z.ZodCoercedNumber<unknown>;
                deposit_balance: z.ZodCoercedNumber<unknown>;
                id_retained: z.ZodBoolean;
                active_items: z.ZodArray<z.ZodObject<{
                    name: z.ZodString;
                    qty: z.ZodCoercedNumber<unknown>;
                    due: z.ZodNullable<z.ZodString>;
                    overdue_days: z.ZodCoercedNumber<unknown>;
                }, z.core.$strip>>;
                invoice_count: z.ZodCoercedNumber<unknown>;
                first_rental: z.ZodNullable<z.ZodString>;
                last_rental: z.ZodNullable<z.ZodString>;
                last_payment: z.ZodNullable<z.ZodObject<{
                    amount: z.ZodCoercedNumber<unknown>;
                    date: z.ZodNullable<z.ZodString>;
                    method: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
                last_review_comment: z.ZodNullable<z.ZodString>;
                summary_line: z.ZodString;
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
                operator_device_id: z.ZodCoercedNumber<unknown>;
                device_label: z.ZodNullable<z.ZodString>;
                display_name: z.ZodString;
                phone_e164: z.ZodString;
                raw_phone: z.ZodNullable<z.ZodString>;
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
}, z.core.$strip>;
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
            }, z.core.$strip>;
            match: z.ZodEnum<{
                customer: "customer";
                contact: "contact";
                none: "none";
            }>;
            brief: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                customer_id: z.ZodCoercedNumber<unknown>;
                display_name: z.ZodString;
                company_name: z.ZodNullable<z.ZodString>;
                parent_company: z.ZodNullable<z.ZodString>;
                phones: z.ZodArray<z.ZodString>;
                rating: z.ZodNullable<z.ZodNumber>;
                status: z.ZodString;
                balance_due: z.ZodCoercedNumber<unknown>;
                deposit_balance: z.ZodCoercedNumber<unknown>;
                id_retained: z.ZodBoolean;
                active_items: z.ZodArray<z.ZodObject<{
                    name: z.ZodString;
                    qty: z.ZodCoercedNumber<unknown>;
                    due: z.ZodNullable<z.ZodString>;
                    overdue_days: z.ZodCoercedNumber<unknown>;
                }, z.core.$strip>>;
                invoice_count: z.ZodCoercedNumber<unknown>;
                first_rental: z.ZodNullable<z.ZodString>;
                last_rental: z.ZodNullable<z.ZodString>;
                last_payment: z.ZodNullable<z.ZodObject<{
                    amount: z.ZodCoercedNumber<unknown>;
                    date: z.ZodNullable<z.ZodString>;
                    method: z.ZodNullable<z.ZodString>;
                }, z.core.$strip>>;
                last_review_comment: z.ZodNullable<z.ZodString>;
                summary_line: z.ZodString;
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
                customer_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                contact_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            }, z.core.$strip>>;
            total: z.ZodCoercedNumber<unknown>;
            page: z.ZodCoercedNumber<unknown>;
            limit: z.ZodCoercedNumber<unknown>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const PushEventRuleSchema: z.ZodObject<{
    enabled: z.ZodBoolean;
    min_amount: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    recipient_role_ids: z.ZodDefault<z.ZodArray<z.ZodCoercedNumber<unknown>>>;
}, z.core.$strip>;
export declare const PushSettingsPayloadSchema: z.ZodObject<{
    events: z.ZodRecord<z.ZodString, z.ZodObject<{
        enabled: z.ZodBoolean;
        min_amount: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
        recipient_role_ids: z.ZodDefault<z.ZodArray<z.ZodCoercedNumber<unknown>>>;
    }, z.core.$strip>>;
    quiet_hours: z.ZodObject<{
        enabled: z.ZodBoolean;
        from: z.ZodString;
        to: z.ZodString;
    }, z.core.$strip>;
    include_amounts: z.ZodBoolean;
    notify_actor: z.ZodBoolean;
}, z.core.$strip>;
export type PushSettingsPayload = z.infer<typeof PushSettingsPayloadSchema>;
export declare const PushEventCatalogItemSchema: z.ZodObject<{
    key: z.ZodString;
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
                }, z.core.$strip>>;
                quiet_hours: z.ZodObject<{
                    enabled: z.ZodBoolean;
                    from: z.ZodString;
                    to: z.ZodString;
                }, z.core.$strip>;
                include_amounts: z.ZodBoolean;
                notify_actor: z.ZodBoolean;
            }, z.core.$strip>;
            catalog: z.ZodArray<z.ZodObject<{
                key: z.ZodString;
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
        }, z.core.$strip>>;
        quiet_hours: z.ZodObject<{
            enabled: z.ZodBoolean;
            from: z.ZodString;
            to: z.ZodString;
        }, z.core.$strip>;
        include_amounts: z.ZodBoolean;
        notify_actor: z.ZodBoolean;
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
                }, z.core.$strip>>;
                quiet_hours: z.ZodObject<{
                    enabled: z.ZodBoolean;
                    from: z.ZodString;
                    to: z.ZodString;
                }, z.core.$strip>;
                include_amounts: z.ZodBoolean;
                notify_actor: z.ZodBoolean;
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
export declare const UserPushPreferenceItemSchema: z.ZodObject<{
    event_key: z.ZodString;
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
                eligible: z.ZodBoolean;
                shop_enabled: z.ZodBoolean;
                has_amount: z.ZodBoolean;
                shop_min_amount: z.ZodCoercedNumber<unknown>;
                enabled: z.ZodBoolean;
                min_amount: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
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
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            preferences: z.ZodArray<z.ZodObject<{
                event_key: z.ZodString;
                eligible: z.ZodBoolean;
                shop_enabled: z.ZodBoolean;
                has_amount: z.ZodBoolean;
                shop_min_amount: z.ZodCoercedNumber<unknown>;
                enabled: z.ZodBoolean;
                min_amount: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
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
                eligible: z.ZodBoolean;
                shop_enabled: z.ZodBoolean;
                has_amount: z.ZodBoolean;
                shop_min_amount: z.ZodCoercedNumber<unknown>;
                enabled: z.ZodBoolean;
                min_amount: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
            }, z.core.$strip>>;
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
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            preferences: z.ZodArray<z.ZodObject<{
                event_key: z.ZodString;
                eligible: z.ZodBoolean;
                shop_enabled: z.ZodBoolean;
                has_amount: z.ZodBoolean;
                shop_min_amount: z.ZodCoercedNumber<unknown>;
                enabled: z.ZodBoolean;
                min_amount: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
            }, z.core.$strip>>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
//# sourceMappingURL=phoneAssistant.d.ts.map