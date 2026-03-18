import { z } from "zod";

export const customerSchema = z.object({
  body: z.object({
    fname: z.string().min(1, "First name is required"),
    lname: z.string().optional(),
    nic: z.string().optional().nullable(),
    phoneNumber: z.string().min(9, "Valid phone number is required"),
    address1: z.string().optional(),
    address2: z.string().optional().nullable(),
    parentId: z.number().optional().nullable(), // Used for child customers
  }),
});
