import { z } from "zod";
export declare const CreateSignatureRequestContract: {
    readonly path: "/invoices/:id/signature-requests";
    readonly method: "POST";
    readonly params: z.ZodObject<{
        id: z.ZodCoercedNumber<unknown>;
    }, z.core.$strip>;
    readonly body: z.ZodObject<{
        checkpoint: z.ZodEnum<{
            DEPOSIT_COLLECTED: "DEPOSIT_COLLECTED";
            EQUIPMENT_DISPATCHED: "EQUIPMENT_DISPATCHED";
            EQUIPMENT_RETURNED: "EQUIPMENT_RETURNED";
            PAYMENT_RECEIVED: "PAYMENT_RECEIVED";
            OTHER: "OTHER";
        }>;
        required_roles: z.ZodArray<z.ZodEnum<{
            CUSTOMER: "CUSTOMER";
            OPERATOR: "OPERATOR";
            GUARANTOR: "GUARANTOR";
            WITNESS: "WITNESS";
        }>>;
        expires_in_minutes: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            token: z.ZodString;
            sign_path: z.ZodString;
            checkpoint: z.ZodEnum<{
                DEPOSIT_COLLECTED: "DEPOSIT_COLLECTED";
                EQUIPMENT_DISPATCHED: "EQUIPMENT_DISPATCHED";
                EQUIPMENT_RETURNED: "EQUIPMENT_RETURNED";
                PAYMENT_RECEIVED: "PAYMENT_RECEIVED";
                OTHER: "OTHER";
            }>;
            required_roles: z.ZodArray<z.ZodEnum<{
                CUSTOMER: "CUSTOMER";
                OPERATOR: "OPERATOR";
                GUARANTOR: "GUARANTOR";
                WITNESS: "WITNESS";
            }>>;
            expires_at: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const GetSignatureSessionContract: {
    readonly path: "/signatures/public/:token";
    readonly method: "GET";
    readonly params: z.ZodObject<{
        token: z.ZodString;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            status: z.ZodEnum<{
                PENDING: "PENDING";
                PARTIAL: "PARTIAL";
                COMPLETED: "COMPLETED";
                EXPIRED: "EXPIRED";
                CANCELLED: "CANCELLED";
            }>;
            checkpoint: z.ZodEnum<{
                DEPOSIT_COLLECTED: "DEPOSIT_COLLECTED";
                EQUIPMENT_DISPATCHED: "EQUIPMENT_DISPATCHED";
                EQUIPMENT_RETURNED: "EQUIPMENT_RETURNED";
                PAYMENT_RECEIVED: "PAYMENT_RECEIVED";
                OTHER: "OTHER";
            }>;
            invoice: z.ZodObject<{
                invoice_id: z.ZodCoercedNumber<unknown>;
                invoice_number: z.ZodString;
                total_amount: z.ZodCoercedNumber<unknown>;
                amount_paid: z.ZodCoercedNumber<unknown>;
                deposit_held: z.ZodCoercedNumber<unknown>;
                customer_name: z.ZodNullable<z.ZodString>;
            }, z.core.$strip>;
            tenant: z.ZodObject<{
                business_display_name: z.ZodString;
                logo_url: z.ZodNullable<z.ZodString>;
                primary_color: z.ZodString;
                secondary_color: z.ZodString;
            }, z.core.$strip>;
            terms: z.ZodObject<{
                markdown: z.ZodString;
                version: z.ZodNumber;
            }, z.core.$strip>;
            required_roles: z.ZodArray<z.ZodEnum<{
                CUSTOMER: "CUSTOMER";
                OPERATOR: "OPERATOR";
                GUARANTOR: "GUARANTOR";
                WITNESS: "WITNESS";
            }>>;
            captured_roles: z.ZodArray<z.ZodObject<{
                role: z.ZodEnum<{
                    CUSTOMER: "CUSTOMER";
                    OPERATOR: "OPERATOR";
                    GUARANTOR: "GUARANTOR";
                    WITNESS: "WITNESS";
                }>;
                signatory_name: z.ZodString;
                captured_at: z.ZodString;
            }, z.core.$strip>>;
            pending_roles: z.ZodArray<z.ZodEnum<{
                CUSTOMER: "CUSTOMER";
                OPERATOR: "OPERATOR";
                GUARANTOR: "GUARANTOR";
                WITNESS: "WITNESS";
            }>>;
            operator_saved_signature: z.ZodNullable<z.ZodObject<{
                operator_user_id: z.ZodCoercedNumber<unknown>;
                operator_name: z.ZodString;
                has_saved_signature: z.ZodBoolean;
            }, z.core.$strip>>;
            expires_at: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const SubmitSignatureContract: {
    readonly path: "/signatures/public/:token";
    readonly method: "POST";
    readonly params: z.ZodObject<{
        token: z.ZodString;
    }, z.core.$strip>;
    readonly body: z.ZodObject<{
        role: z.ZodEnum<{
            CUSTOMER: "CUSTOMER";
            OPERATOR: "OPERATOR";
            GUARANTOR: "GUARANTOR";
            WITNESS: "WITNESS";
        }>;
        signatory_name: z.ZodString;
        agreed_to_terms: z.ZodLiteral<true>;
        terms_version: z.ZodNumber;
        use_stored_operator_signature: z.ZodDefault<z.ZodBoolean>;
        image_data_url: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            signature_id: z.ZodCoercedNumber<unknown>;
            role: z.ZodEnum<{
                CUSTOMER: "CUSTOMER";
                OPERATOR: "OPERATOR";
                GUARANTOR: "GUARANTOR";
                WITNESS: "WITNESS";
            }>;
            status: z.ZodEnum<{
                PENDING: "PENDING";
                PARTIAL: "PARTIAL";
                COMPLETED: "COMPLETED";
                EXPIRED: "EXPIRED";
                CANCELLED: "CANCELLED";
            }>;
            captured_roles: z.ZodArray<z.ZodEnum<{
                CUSTOMER: "CUSTOMER";
                OPERATOR: "OPERATOR";
                GUARANTOR: "GUARANTOR";
                WITNESS: "WITNESS";
            }>>;
            pending_roles: z.ZodArray<z.ZodEnum<{
                CUSTOMER: "CUSTOMER";
                OPERATOR: "OPERATOR";
                GUARANTOR: "GUARANTOR";
                WITNESS: "WITNESS";
            }>>;
            all_captured: z.ZodBoolean;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const CancelSignatureRequestContract: {
    readonly path: "/signatures/requests/:token";
    readonly method: "DELETE";
    readonly params: z.ZodObject<{
        token: z.ZodString;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            cancelled: z.ZodBoolean;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const ListInvoiceSignaturesContract: {
    readonly path: "/invoices/:id/signatures";
    readonly method: "GET";
    readonly params: z.ZodObject<{
        id: z.ZodCoercedNumber<unknown>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            signatures: z.ZodArray<z.ZodObject<{
                signature_id: z.ZodCoercedNumber<unknown>;
                checkpoint: z.ZodEnum<{
                    DEPOSIT_COLLECTED: "DEPOSIT_COLLECTED";
                    EQUIPMENT_DISPATCHED: "EQUIPMENT_DISPATCHED";
                    EQUIPMENT_RETURNED: "EQUIPMENT_RETURNED";
                    PAYMENT_RECEIVED: "PAYMENT_RECEIVED";
                    OTHER: "OTHER";
                }>;
                role: z.ZodEnum<{
                    CUSTOMER: "CUSTOMER";
                    OPERATOR: "OPERATOR";
                    GUARANTOR: "GUARANTOR";
                    WITNESS: "WITNESS";
                }>;
                signatory_name: z.ZodString;
                signatory_user_id: z.ZodNullable<z.ZodCoercedNumber<unknown>>;
                image_url: z.ZodString;
                source: z.ZodEnum<{
                    PHONE_CANVAS: "PHONE_CANVAS";
                    POS_CANVAS: "POS_CANVAS";
                    STORED_OPERATOR_SIG: "STORED_OPERATOR_SIG";
                }>;
                captured_at: z.ZodString;
                terms_version_signed: z.ZodNullable<z.ZodNumber>;
            }, z.core.$strip>>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const SetOperatorSignatureContract: {
    readonly path: "/me/signature";
    readonly method: "POST";
    readonly body: z.ZodObject<{
        image_data_url: z.ZodString;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            signature_url: z.ZodString;
            captured_at: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const DeleteOperatorSignatureContract: {
    readonly path: "/me/signature";
    readonly method: "DELETE";
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            deleted: z.ZodBoolean;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const GetRentalTermsContract: {
    readonly path: "/config/rental-terms";
    readonly method: "GET";
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            markdown: z.ZodString;
            version: z.ZodNumber;
            updated_at: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const UpdateRentalTermsContract: {
    readonly path: "/config/rental-terms";
    readonly method: "PUT";
    readonly body: z.ZodObject<{
        markdown: z.ZodString;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            markdown: z.ZodString;
            version: z.ZodNumber;
            updated_at: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const DeviceStatusEnum: z.ZodEnum<{
    PENDING: "PENDING";
    ACTIVE: "ACTIVE";
    SUSPENDED: "SUSPENDED";
    REVOKED: "REVOKED";
}>;
export type DeviceStatus = z.infer<typeof DeviceStatusEnum>;
export declare const DeviceCapabilityKeyEnum: z.ZodEnum<{
    push: "push";
    signatures: "signatures";
    photos: "photos";
    caller_brief: "caller_brief";
    bill_view: "bill_view";
    contact_sync: "contact_sync";
    call_logging: "call_logging";
    click_to_call: "click_to_call";
}>;
export type DeviceCapabilityKey = z.infer<typeof DeviceCapabilityKeyEnum>;
export declare const DeviceCapabilityMapSchema: z.ZodObject<{
    signatures: z.ZodOptional<z.ZodBoolean>;
    photos: z.ZodOptional<z.ZodBoolean>;
    caller_brief: z.ZodOptional<z.ZodBoolean>;
    bill_view: z.ZodOptional<z.ZodBoolean>;
    push: z.ZodOptional<z.ZodBoolean>;
    contact_sync: z.ZodOptional<z.ZodBoolean>;
    call_logging: z.ZodOptional<z.ZodBoolean>;
    click_to_call: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export type DeviceCapabilityMap = z.infer<typeof DeviceCapabilityMapSchema>;
export declare const MintPairingCodeContract: {
    readonly path: "/me/devices/pairing-code";
    readonly method: "POST";
    readonly body: z.ZodOptional<z.ZodObject<{
        requested_capabilities: z.ZodOptional<z.ZodObject<{
            signatures: z.ZodOptional<z.ZodBoolean>;
            photos: z.ZodOptional<z.ZodBoolean>;
            caller_brief: z.ZodOptional<z.ZodBoolean>;
            bill_view: z.ZodOptional<z.ZodBoolean>;
            push: z.ZodOptional<z.ZodBoolean>;
            contact_sync: z.ZodOptional<z.ZodBoolean>;
            call_logging: z.ZodOptional<z.ZodBoolean>;
            click_to_call: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            code: z.ZodString;
            expires_at: z.ZodString;
            requested_capabilities: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                signatures: z.ZodOptional<z.ZodBoolean>;
                photos: z.ZodOptional<z.ZodBoolean>;
                caller_brief: z.ZodOptional<z.ZodBoolean>;
                bill_view: z.ZodOptional<z.ZodBoolean>;
                push: z.ZodOptional<z.ZodBoolean>;
                contact_sync: z.ZodOptional<z.ZodBoolean>;
                call_logging: z.ZodOptional<z.ZodBoolean>;
                click_to_call: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strip>>>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const GetPairingCodePreviewContract: {
    readonly path: "/public/devices/pair/:code";
    readonly method: "GET";
    readonly params: z.ZodObject<{
        code: z.ZodString;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            code: z.ZodString;
            shop_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            staff_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            expires_at: z.ZodString;
            requested_capabilities: z.ZodRecord<z.ZodString, z.ZodBoolean>;
            approval_mode: z.ZodOptional<z.ZodEnum<{
                admin_approves_all: "admin_approves_all";
                auto_approve_admin_phones: "auto_approve_admin_phones";
                auto_approve_all: "auto_approve_all";
            }>>;
            will_require_approval: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const ClaimPairingCodeContract: {
    readonly path: "/public/devices/pair";
    readonly method: "POST";
    readonly body: z.ZodObject<{
        code: z.ZodString;
        device_id: z.ZodString;
        device_label: z.ZodOptional<z.ZodString>;
        device_model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        os_version: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        app_version: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        consented_capabilities: z.ZodOptional<z.ZodObject<{
            signatures: z.ZodOptional<z.ZodBoolean>;
            photos: z.ZodOptional<z.ZodBoolean>;
            caller_brief: z.ZodOptional<z.ZodBoolean>;
            bill_view: z.ZodOptional<z.ZodBoolean>;
            push: z.ZodOptional<z.ZodBoolean>;
            contact_sync: z.ZodOptional<z.ZodBoolean>;
            call_logging: z.ZodOptional<z.ZodBoolean>;
            click_to_call: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            operator_device_id: z.ZodCoercedNumber<unknown>;
            device_id: z.ZodString;
            tenant_db_name: z.ZodOptional<z.ZodString>;
            device_token: z.ZodOptional<z.ZodString>;
            status: z.ZodOptional<z.ZodEnum<{
                PENDING: "PENDING";
                ACTIVE: "ACTIVE";
                SUSPENDED: "SUSPENDED";
                REVOKED: "REVOKED";
            }>>;
            effective_capabilities: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
            operator: z.ZodObject<{
                user_id: z.ZodCoercedNumber<unknown>;
                operator_name: z.ZodString;
                has_saved_signature: z.ZodBoolean;
                username: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            }, z.core.$strip>;
            tenant: z.ZodObject<{
                business_display_name: z.ZodString;
                logo_url: z.ZodNullable<z.ZodString>;
                primary_color: z.ZodString;
                secondary_color: z.ZodString;
            }, z.core.$strip>;
            paired_at: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const GetDeviceStatusContract: {
    readonly path: "/public/devices/:device_id/status";
    readonly method: "GET";
    readonly params: z.ZodObject<{
        device_id: z.ZodString;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            paired: z.ZodBoolean;
            shop_inactive: z.ZodOptional<z.ZodBoolean>;
            device_status: z.ZodOptional<z.ZodEnum<{
                PENDING: "PENDING";
                ACTIVE: "ACTIVE";
                SUSPENDED: "SUSPENDED";
                REVOKED: "REVOKED";
            }>>;
            operator: z.ZodNullable<z.ZodObject<{
                user_id: z.ZodCoercedNumber<unknown>;
                operator_name: z.ZodString;
                has_saved_signature: z.ZodBoolean;
                username: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            }, z.core.$strip>>;
            tenant: z.ZodNullable<z.ZodObject<{
                business_display_name: z.ZodString;
                logo_url: z.ZodNullable<z.ZodString>;
                primary_color: z.ZodString;
                secondary_color: z.ZodString;
            }, z.core.$strip>>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const ListMyDevicesContract: {
    readonly path: "/me/devices";
    readonly method: "GET";
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            devices: z.ZodArray<z.ZodObject<{
                operator_device_id: z.ZodCoercedNumber<unknown>;
                device_id: z.ZodString;
                device_label: z.ZodNullable<z.ZodString>;
                user_agent: z.ZodNullable<z.ZodString>;
                paired_at: z.ZodString;
                last_seen_at: z.ZodNullable<z.ZodString>;
                status: z.ZodOptional<z.ZodEnum<{
                    PENDING: "PENDING";
                    ACTIVE: "ACTIVE";
                    SUSPENDED: "SUSPENDED";
                    REVOKED: "REVOKED";
                }>>;
                device_model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                os_version: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                effective_capabilities: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
                is_native_app: z.ZodOptional<z.ZodBoolean>;
                app_version: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                contact_sync_enabled: z.ZodOptional<z.ZodBoolean>;
                contact_count: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
                contacts_synced_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                briefs_synced_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            }, z.core.$strip>>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const UnpairDeviceContract: {
    readonly path: "/me/devices/:operator_device_id";
    readonly method: "DELETE";
    readonly params: z.ZodObject<{
        operator_device_id: z.ZodCoercedNumber<unknown>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            unpaired: z.ZodBoolean;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export declare const GetDevicePendingSignaturesContract: {
    readonly path: "/public/devices/:device_id/pending-signatures";
    readonly method: "GET";
    readonly params: z.ZodObject<{
        device_id: z.ZodString;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            pending: z.ZodArray<z.ZodObject<{
                token: z.ZodString;
                invoice_id: z.ZodCoercedNumber<unknown>;
                invoice_number: z.ZodString;
                checkpoint: z.ZodEnum<{
                    DEPOSIT_COLLECTED: "DEPOSIT_COLLECTED";
                    EQUIPMENT_DISPATCHED: "EQUIPMENT_DISPATCHED";
                    EQUIPMENT_RETURNED: "EQUIPMENT_RETURNED";
                    PAYMENT_RECEIVED: "PAYMENT_RECEIVED";
                    OTHER: "OTHER";
                }>;
                required_roles: z.ZodArray<z.ZodEnum<{
                    CUSTOMER: "CUSTOMER";
                    OPERATOR: "OPERATOR";
                    GUARANTOR: "GUARANTOR";
                    WITNESS: "WITNESS";
                }>>;
                pending_roles: z.ZodArray<z.ZodEnum<{
                    CUSTOMER: "CUSTOMER";
                    OPERATOR: "OPERATOR";
                    GUARANTOR: "GUARANTOR";
                    WITNESS: "WITNESS";
                }>>;
                expires_at: z.ZodString;
            }, z.core.$strip>>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
//# sourceMappingURL=signatures.d.ts.map