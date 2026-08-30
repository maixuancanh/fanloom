import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const LOCAL_DEMO_USER_ID = "00000000-0000-0000-0000-000000000001";

try {
  const creator = await db.creator.findUnique({
    where: { userId: LOCAL_DEMO_USER_ID },
    select: { id: true, displayName: true },
  });
  if (!creator) throw new Error("local_demo_creator_not_found");

  const audit = await db.mindAdvisorAudit.findFirst({
    where: { creatorId: creator.id, recommendation: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true },
  });
  if (!audit) throw new Error("accepted_advisor_checkpoint_not_found");

  const followUpAt = new Date();
  await db.mindAdvisorAudit.update({ where: { id: audit.id }, data: { followUpAt } });
  process.stdout.write(`${JSON.stringify({ creator: creator.displayName, auditId: audit.id, checkpointCreatedAt: audit.createdAt, followUpAt })}\n`);
} finally {
  await db.$disconnect();
}
