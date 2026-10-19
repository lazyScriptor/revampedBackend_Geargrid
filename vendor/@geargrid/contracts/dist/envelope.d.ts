import { z } from "zod";
export declare const successEnvelope: <T extends z.ZodTypeAny>(data: T) => z.ZodObject<{
    status: z.ZodLiteral<"success">;
    message: z.ZodOptional<z.ZodString>;
    data: T;
}, z.core.$strip>;
export declare const errorEnvelope: z.ZodObject<{
    status: z.ZodLiteral<"error">;
    message: z.ZodString;
    code: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export interface Contract<TParams = unknown, TQuery = unknown, TBody = unknown, TData = unknown> {
    path: string;
    method: HttpMethod;
    params?: z.ZodType<TParams>;
    query?: z.ZodType<TQuery>;
    body?: z.ZodType<TBody>;
    response: z.ZodType<{
        status: "success";
        message?: string;
        data: TData;
    }>;
}
//# sourceMappingURL=envelope.d.ts.map