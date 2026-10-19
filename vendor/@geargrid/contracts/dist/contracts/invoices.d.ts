import { z } from "zod";
export declare const VaultToggleData: z.ZodObject<{
    is_id_retained_currently: z.ZodBoolean;
    id_card_status: z.ZodUnion<readonly [z.ZodLiteral<0>, z.ZodLiteral<1>]>;
}, z.core.$strip>;
export type VaultToggleData = z.infer<typeof VaultToggleData>;
export declare const VaultToggleContract: {
    readonly path: "/invoices/:id/vault";
    readonly method: "PATCH";
    readonly params: z.ZodObject<{
        id: z.ZodCoercedNumber<unknown>;
    }, z.core.$strip>;
    readonly response: z.ZodObject<{
        status: z.ZodLiteral<"success">;
        message: z.ZodOptional<z.ZodString>;
        data: z.ZodObject<{
            is_id_retained_currently: z.ZodBoolean;
            id_card_status: z.ZodUnion<readonly [z.ZodLiteral<0>, z.ZodLiteral<1>]>;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
//# sourceMappingURL=invoices.d.ts.map