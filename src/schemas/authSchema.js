import { z } from "zod";

export const registerSchema = z.object({
  body: z.object({
    tenantId: z.string({ required_error: "Tenant ID is required" }),
    email: z.string().email("Invalid email format"),
    username: z.string().min(3, "Username must be at least 3 characters"),
    password: z.string().min(6, "Password must be at least 6 characters"),
    firstName: z.string({ required_error: "First name is required" }),
    lastName: z.string({ required_error: "Last name is required" }),
    nicNo: z.string({ required_error: "NIC Number is required" }),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email("Invalid email format"),
    password: z.string().min(1, "Password is required"),
  }),
});
