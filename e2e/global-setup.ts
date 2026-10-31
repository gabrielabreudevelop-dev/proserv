/**
 * Recria o banco de E2E do zero: apaga o schema, aplica as migrações e roda o seed.
 * Por segurança, só aceita bancos cujo nome termine em "_e2e".
 */
import { execSync } from "node:child_process";
import { Client } from "pg";
import { E2E_DATABASE_URL } from "../playwright.config";

export default async function globalSetup() {
  const dbName = new URL(E2E_DATABASE_URL).pathname.slice(1);
  if (!dbName.endsWith("_e2e")) throw new Error(`Recusado: o banco de E2E precisa terminar em "_e2e" (recebido "${dbName}").`);

  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  await client.end();

  const env = { ...process.env, DATABASE_URL: E2E_DATABASE_URL };
  execSync("npx prisma migrate deploy", { env, stdio: "inherit" });
  execSync("npx prisma db seed", { env, stdio: "inherit" });
}
