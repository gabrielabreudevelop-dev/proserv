import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins";
import { prisma } from "@/lib/db";
import { ac, roles } from "./permissions";

export const auth = betterAuth({
  appName: "ProServ",
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    // Contas são criadas pelo administrador; não há cadastro público.
    disableSignUp: true,
    minPasswordLength: 8,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 dias
    updateAge: 60 * 60 * 24, // renova uma vez por dia
  },
  user: {
    additionalFields: {
      dashboardFocus: { type: "string", required: false, input: false },
    },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 30,
  },
  plugins: [
    admin({
      ac,
      roles,
      defaultRole: "vendedor",
      adminRoles: ["admin"],
    }),
    nextCookies(), // precisa ser o último plugin
  ],
});

export type Session = typeof auth.$Infer.Session;
