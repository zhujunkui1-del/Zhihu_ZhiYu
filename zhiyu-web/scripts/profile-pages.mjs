/**
 * 剖析各页面的数据装配耗时，找出冷导航慢的原因。
 *
 * 直接调 lib 里的 build* 函数（绕过 HTTP），分别计时；
 * 再拆开看单个查询的耗时，判断是"查询多"还是"单个查询慢"。
 */
process.env.NODE_ENV = "development";

const { PrismaClient } = await import("@prisma/client");
const { PrismaNeon } = await import("@prisma/adapter-neon");

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

const t = async (label, fn, times = 3) => {
  const runs = [];
  let out;
  for (let i = 0; i < times; i += 1) {
    const t0 = Date.now();
    out = await fn();
    runs.push(Date.now() - t0);
  }
  console.log(`  ${label.padEnd(30)} ${runs.map((x) => `${x}ms`).join(" / ")}`);
  return out;
};

console.log("数据装配耗时剖析（每项跑 3 次）");
console.log("=".repeat(76));

const demo = await prisma.user.findUnique({
  where: { username: "demo" },
  include: { persona: true },
});
const pid = demo.persona.id;
const uid = demo.id;
console.log(`演示人格 ${pid}\n`);

console.log("【单个查询】");
await t("user (含 persona 关联)", async () =>
  prisma.user.findUnique({ where: { username: "demo" }, include: { persona: true } }),
);
await t("persona 单表", async () => prisma.persona.findUnique({ where: { id: pid } }));
await t("personaSource 列表", async () =>
  prisma.personaSource.findMany({ where: { personaId: pid } }),
);
await t("persona 候选池(16条)", async () =>
  prisma.persona.findMany({ where: { kind: "synthetic" }, take: 40 }),
);
await t("match 列表(含关联)", async () =>
  prisma.match.findMany({
    where: { OR: [{ personaAId: pid }, { personaBId: pid }] },
    include: { personaA: true, personaB: true, report: true },
    take: 50,
  }),
);
await t("notification 列表", async () =>
  prisma.notification.findMany({ where: { userId: uid }, take: 100 }),
);

console.log("\n【并发 vs 串行】");
const { buildHome } = await import("../lib/home.ts");
const { buildDiscover } = await import("../lib/discover.ts");

await t("buildHome（整页装配）", () => buildHome(pid, uid));
await t("buildDiscover（整页装配）", () => buildDiscover(pid));

console.log("\n【诊断】");
console.log("  若单个查询都在 200ms 以上 → 主要是 Neon 网络往返（新加坡节点）");
console.log("  若装配耗时 ≈ 各查询之和 → 查询是串行的，可改并发");

await prisma.$disconnect();
