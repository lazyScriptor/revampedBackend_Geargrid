import { z } from "zod";
// Every GearGrid success response has this shape.
// The axios interceptor on the frontend returns the parsed body (this object),
// NOT the raw AxiosResponse. See revampedFrontend/src/lib/api.ts.
export const successEnvelope = (data) => z.object({
    status: z.literal("success"),
    message: z.string().optional(),
    data,
});
export const errorEnvelope = z.object({
    status: z.literal("error"),
    message: z.string(),
    code: z.string().optional(),
});
//# sourceMappingURL=envelope.js.map