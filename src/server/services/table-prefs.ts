import { z } from "zod";
import { prisma } from "@/lib/db";

export const tableStateSchema = z.object({
  columnVisibility: z.record(z.string().max(64), z.boolean()).default({}),
  pageSize: z.number().int().min(10).max(100).optional(),
});
export type TableState = z.infer<typeof tableStateSchema>;

export async function getTablePref(userId: string, tableKey: string): Promise<TableState | null> {
  const row = await prisma.tablePreference.findUnique({ where: { userId_tableKey: { userId, tableKey } } });
  if (!row) return null;
  const parsed = tableStateSchema.safeParse(row.state);
  return parsed.success ? parsed.data : null;
}

export async function saveTablePref(userId: string, tableKey: string, state: TableState) {
  await prisma.tablePreference.upsert({
    where: { userId_tableKey: { userId, tableKey } },
    update: { state },
    create: { userId, tableKey, state },
  });
}
