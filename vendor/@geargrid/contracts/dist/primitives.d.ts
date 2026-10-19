import { z } from "zod";
export declare const Money: z.ZodCoercedNumber<unknown>;
export declare const PositiveInt: z.ZodCoercedNumber<unknown>;
export declare const NonNegativeInt: z.ZodCoercedNumber<unknown>;
export declare const IdCardStatus: z.ZodUnion<readonly [z.ZodLiteral<0>, z.ZodLiteral<1>]>;
export declare const ISODate: z.ZodString;
export declare const SignatureCheckpoint: z.ZodEnum<{
    DEPOSIT_COLLECTED: "DEPOSIT_COLLECTED";
    EQUIPMENT_DISPATCHED: "EQUIPMENT_DISPATCHED";
    EQUIPMENT_RETURNED: "EQUIPMENT_RETURNED";
    PAYMENT_RECEIVED: "PAYMENT_RECEIVED";
    OTHER: "OTHER";
}>;
export type SignatureCheckpoint = z.infer<typeof SignatureCheckpoint>;
export declare const SignatureRole: z.ZodEnum<{
    CUSTOMER: "CUSTOMER";
    OPERATOR: "OPERATOR";
    GUARANTOR: "GUARANTOR";
    WITNESS: "WITNESS";
}>;
export type SignatureRole = z.infer<typeof SignatureRole>;
export declare const SignatureSource: z.ZodEnum<{
    PHONE_CANVAS: "PHONE_CANVAS";
    POS_CANVAS: "POS_CANVAS";
    STORED_OPERATOR_SIG: "STORED_OPERATOR_SIG";
}>;
export type SignatureSource = z.infer<typeof SignatureSource>;
export declare const SignatureStatus: z.ZodEnum<{
    PENDING: "PENDING";
    PARTIAL: "PARTIAL";
    COMPLETED: "COMPLETED";
    EXPIRED: "EXPIRED";
    CANCELLED: "CANCELLED";
}>;
export type SignatureStatus = z.infer<typeof SignatureStatus>;
//# sourceMappingURL=primitives.d.ts.map