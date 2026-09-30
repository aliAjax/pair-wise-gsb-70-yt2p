/**
 * 核心一致性测试（不依赖 DOM / React，直接跑服务层）：
 * 1. 并发保存四类内容：后提交的人撞 revision，不覆盖、能看到对方版本
 * 2. 定义一变：旧结论归档失效、调用方确认失效
 * 3. 发布原子快照：只含有效结论/确认/豁免，校验值随内容变化
 * 4. 幂等重试：同一幂等键重试不产生第二个版本，且失败不留半个版本
 * 5. 批量结论：任一契约冲突则整体中止
 *
 * 运行：node scripts/run-service-tests.mjs
 */
import { createJiti } from 'jiti';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(import.meta.url, { alias: {} });
const svc = await jiti.import(
  path.join(__dirname, '../src/services/contract-service.ts'),
);
const model = await jiti.import(path.join(__dirname, '../src/models/contract.ts'));

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function section(name: string, fn: () => Promise<void> | void): Promise<void> {
  console.log(`\n${name}`);
  await fn();
}

/* -------------------------------------------------------------------------- */

function freshStore(): { store: Map<string, string> } {
  const store = new Map<string, string>();
  svc.__setStorageDriver({
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => void store.set(key, value),
  });
  return { store };
}

await section('1. 并发保存：revision 冲突，后提交者不覆盖对方内容', async () => {
  freshStore();
  const initial = await svc.getContract('contract-order');
  check('种子契约带 revision', initial.revision >= 1);

  // 评审人 A 先保存结论成功，revision +1
  const afterA = await svc.reviewChange({
    contractId: 'contract-order',
    changeId: 'chg-order-3',
    reviewState: 'returned',
    reviewer: '评审人A',
    comment: 'A 的退回意见',
    expectedRevision: initial.revision,
  });
  check('A 保存后 revision 递增', afterA.revision === initial.revision + 1);
  check('A 的内容已落盘', afterA.changes[2].reviewer === '评审人A');

  // 评审人 B 仍基于旧 revision 保存
  let conflict: unknown = null;
  try {
    await svc.reviewChange({
      contractId: 'contract-order',
      changeId: 'chg-order-3',
      reviewState: 'accepted',
      reviewer: '评审人B',
      comment: 'B 的接受意见',
      expectedRevision: initial.revision,
    });
  } catch (error) {
    conflict = error;
  }
  check('B 拿到 RevisionConflictError', svc.RevisionConflictError && conflict instanceof svc.RevisionConflictError);
  const conflictError = conflict as InstanceType<typeof svc.RevisionConflictError>;
  check(
    '冲突返回服务端最新副本（含 A 的改动）',
    conflictError.server.changes[2].reviewer === '评审人A',
  );

  // B 的内容确实没有覆盖
  const stored = await svc.getContract('contract-order');
  check('B 未覆盖 A 的内容', stored!.changes[2].reviewer === '评审人A');

  // B 刷新到最新 revision 后重试成功
  const afterB = await svc.reviewChange({
    contractId: 'contract-order',
    changeId: 'chg-order-3',
    reviewState: 'accepted',
    reviewer: '评审人B',
    comment: 'B 基于最新版重新接受',
    expectedRevision: stored!.revision,
  });
  check('B 基于最新 revision 重试成功', afterB.changes[2].reviewer === '评审人B');
});

await section('2. 定义变更：旧结论与调用方确认级联失效', async () => {
  freshStore();
  const initial = await svc.getContract('contract-order');
  check(
    '初始存在有效结论',
    initial.changes.some((c: (typeof initial.changes)[number]) => c.reviewState === 'accepted'),
  );

  const next = await svc.saveContractSection({
    contractId: 'contract-order',
    expectedRevision: initial.revision,
    section: 'definition',
    openapi: initial.openapi + '\n# definition changed by another reviewer\n',
  });
  check('定义修订号递增', next.definitionRevision === initial.definitionRevision + 1);
  check('保存修订号递增', next.revision === initial.revision + 1);

  const freshConclusions = next.changes.filter(
    (c: (typeof next.changes)[number]) =>
      c.definitionRevision >= next.definitionRevision && c.reviewState !== 'pending',
  );
  check('新定义下没有残留的非 pending 结论', freshConclusions.length === 0);
  const stillStale = next.changes.find((c: { id: string }) => c.id === 'chg-order-2');
  check(
    '本来就失效的旧结论保持旧修订号（不会冒充有效）',
    stillStale.definitionRevision < next.definitionRevision,
  );

  // 旧的 accepted 结论应被归档（chg-order-1 是当前定义下有效的 accepted）
  const order1 = next.changes.find((c: { id: string }) => c.id === 'chg-order-1');
  check('旧结论进入 history 留痕', order1.history.length >= 1);
  check('旧结论状态被重置为 pending', order1.reviewState === 'pending');

  // 之前确认过第 2 版的 consumer-app 现在失效
  const appConfirmation = next.confirmations.find(
    (c: { consumerId: string }) => c.consumerId === 'consumer-app',
  );
  check('调用方确认回到 pending', appConfirmation.state === 'pending');
  check('确认绑定新定义修订号', appConfirmation.definitionRevision === next.definitionRevision);

  // 门禁：失效结论和未确认调用方成为 blocker
  const issues = model.validateForRelease(next);
  check(
    '失效结论出现在发布门禁',
    issues.some((i: { id: string }) => i.id.startsWith('stale-') || i.id.startsWith('pending-')),
  );
  check(
    '未确认调用方出现在发布门禁',
    issues.some((i: { id: string }) => i.id === 'consumer-consumer-cs'),
  );

  // 同样的定义内容再次保存：revision 变，但 definitionRevision 不应变、结论不应再失效
  const noop = await svc.saveContractSection({
    contractId: 'contract-order',
    expectedRevision: next.revision,
    section: 'definition',
    openapi: next.openapi,
  });
  check('定义文本未变时 definitionRevision 不变', noop.definitionRevision === next.definitionRevision);
});

await section('3. 调用方重新确认 + 逐条重新评审后门禁恢复', async () => {
  freshStore();
  let current = await svc.getContract('contract-order');
  current = await svc.saveContractSection({
    contractId: 'contract-order',
    expectedRevision: current.revision,
    section: 'definition',
    openapi: current.openapi + '\n# v-next\n',
  });

  // 三个调用方全部确认新定义
  for (const consumer of current.consumers) {
    current = await svc.confirmConsumer({
      contractId: 'contract-order',
      consumerId: consumer.id,
      confirmed: true,
      confirmer: `${consumer.name}负责人`,
      comment: '已完成兼容验证',
      expectedRevision: current.revision,
    });
  }
  const consumerBlockers = model
    .validateForRelease(current)
    .filter((i: { id: string }) => i.id.startsWith('consumer-'));
  check('调用方确认后无 consumer blocker', consumerBlockers.length === 0);

  // 对失效变更逐条重新给结论
  for (const change of current.changes) {
    current = await svc.reviewChange({
      contractId: 'contract-order',
      changeId: change.id,
      reviewState: change.compatibility === 'compatible' ? 'accepted' : 'exemption',
      reviewer: '评审人A',
      comment: '基于新定义重新确认',
      expectedRevision: current.revision,
    });
  }
  const staleBlockers = model
    .validateForRelease(current)
    .filter((i: { id: string }) => i.id.startsWith('stale-'));
  check('重新评审后无 stale blocker', staleBlockers.length === 0);
});

await section('4. 发布原子快照与校验值', async () => {
  freshStore();
  // payment 契约：所有结论有效、调用方确认齐备，只有一个 returned 结论 -> 需要先改判
  let payment = await svc.getContract('contract-payment');
  check('payment 初始 definitionRevision=1', payment.definitionRevision === 1);

  // chg-pay-1 是 returned（仍是一个有效结论，不算 blocker）——校验门禁
  const beforeIssues = model.validateForRelease(payment);
  check(
    'returned 且非 pending 不算 blocker',
    !beforeIssues.some((i: { severity: string }) => i.severity === 'blocker'),
  );

  const key = 'release-key-1';
  const beforeVersionCount = payment.versions.length;
  const released = await svc.freezeVersion({
    contractId: 'contract-payment',
    expectedRevision: payment.revision,
    version: '4.2.0',
    notes: '正式发布 4.2',
    idempotencyKey: key,
  });
  const version = released.versions[0];
  check('版本已生成', released.versions.length === beforeVersionCount + 1);
  check('新发布版本排在最前', version.version === '4.2.0');
  check('状态 frozen', released.status === 'frozen');
  check('快照含定义', version.openapi.includes('4.2.0'));
  check('快照含 2 条有效结论', version.changes.length === 2);
  check('快照含 2 方确认', version.confirmations.length === 2);
  check('快照含豁免数组（可为 0）', Array.isArray(version.exemptions));
  check('校验值为 8 位 hex', /^[0-9a-f]{8}$/.test(version.checksum));
  check(
    '结论快照绑定定义修订号',
    version.changes.every((c: { definitionRevision: number }) => c.definitionRevision === 1),
  );

  // 幂等：用同一 key 再调一次，不产生第二个版本、revision 不再增加
  const revisionAfterRelease = released.revision;
  const retry = await svc.freezeVersion({
    contractId: 'contract-payment',
    expectedRevision: released.revision,
    version: '4.2.0',
    notes: '重试',
    idempotencyKey: key,
  });
  check('幂等重试不产生新版本', retry.versions.length === beforeVersionCount + 1);
  check('幂等重试不增加 revision', retry.revision === revisionAfterRelease);
  check('发布说明保持首次内容', retry.versions[0].notes === '正式发布 4.2');

  // 已发布工作副本继续改定义，不影响版本快照
  const changed = await svc.saveContractSection({
    contractId: 'contract-payment',
    expectedRevision: retry.revision,
    section: 'definition',
    openapi: retry.openapi + '\n# 4.3 work\n',
  });
  check('发布后定义可继续演进', changed.definitionRevision === 2);
  check('版本快照内容不变', changed.versions[0].openapi.includes('4.2.0'));
  check(
    '历史比较知道工作副本已超前',
    changed.versions[0].definitionRevision === 1 && changed.definitionRevision === 2,
  );

  // 校验值随内容不同而不同：手工构造一个豁免齐备的 order 发布场景成本高，
  // 直接验证 computeReleaseChecksum 对不同输入给出不同值
  const c1 = svc.computeReleaseChecksum({
    version: '1.0.0',
    openapi: 'a',
    changes: [],
    confirmations: [],
    exemptions: [],
  });
  const c2 = svc.computeReleaseChecksum({
    version: '1.0.0',
    openapi: 'b',
    changes: [],
    confirmations: [],
    exemptions: [],
  });
  check('定义不同则校验值不同', c1 !== c2);
});

await section('5. 门禁失败不产生半个版本', async () => {
  freshStore();
  const order = await svc.getContract('contract-order');
  const beforeVersionCount = order.versions.length;

  let blocked: unknown = null;
  try {
    await svc.freezeVersion({
      contractId: 'contract-order',
      expectedRevision: order.revision,
      version: '9.9.9',
      notes: '不该成功',
      idempotencyKey: 'bad-release',
    });
  } catch (error) {
    blocked = error;
  }
  check('存在阻断项时发布抛错', blocked instanceof Error);

  const after = await svc.getContract('contract-order');
  check('失败后版本数量不变（无半个版本）', after.versions.length === beforeVersionCount);
  check('失败后 revision 不变（无副作用）', after.revision === order.revision);
  check('失败后状态不被改成 frozen', after.status !== 'frozen');

  // 用同一个幂等键修好数据后再发，不应该被历史失败的幂等记录挡住
  let current = after;
  // order 契约需要：3 个调用方确认 + 失效/ pending 变更全部结论
  current = await svc.saveContractSection({
    contractId: 'contract-order',
    expectedRevision: current.revision,
    section: 'definition',
    openapi: current.openapi,
  });
  for (const consumer of current.consumers) {
    const exists = current.confirmations.find(
      (c: { consumerId: string }) => c.consumerId === consumer.id,
    );
    if (exists && exists.state === 'confirmed' && exists.definitionRevision >= current.definitionRevision) {
      continue;
    }
    current = await svc.confirmConsumer({
      contractId: 'contract-order',
      consumerId: consumer.id,
      confirmed: true,
      confirmer: '负责人',
      comment: 'ok',
      expectedRevision: current.revision,
    });
  }
  for (const change of current.changes) {
    const valid =
      change.definitionRevision >= current.definitionRevision &&
      change.reviewState !== 'pending';
    if (valid) continue;
    current = await svc.reviewChange({
      contractId: 'contract-order',
      changeId: change.id,
      reviewState: change.compatibility === 'compatible' ? 'accepted' : 'exemption',
      reviewer: '评审人',
      comment: '补齐',
      expectedRevision: current.revision,
    });
  }
  const issues = model.validateForRelease(current);
  check(
    '补齐后门禁仅剩 warning 或通过',
    !issues.some((i: { severity: string }) => i.severity === 'blocker'),
    JSON.stringify(issues),
  );
  const released = await svc.freezeVersion({
    contractId: 'contract-order',
    expectedRevision: current.revision,
    version: '2.8.0',
    notes: '补齐后发布',
    idempotencyKey: 'bad-release',
  });
  check('之前失败的幂等键不阻碍成功发布', released.versions[0].version === '2.8.0');
});

await section('6. 批量评审：部分契约冲突则整体中止', async () => {
  freshStore();
  const order = await svc.getContract('contract-order');
  const payment = await svc.getContract('contract-payment');

  // 模拟别人先改了 payment
  const paymentChanged = await svc.reviewChange({
    contractId: 'contract-payment',
    changeId: 'chg-pay-2',
    reviewState: 'returned',
    reviewer: '别人',
    comment: '先退回',
    expectedRevision: payment.revision,
  });

  let bulkConflict: unknown = null;
  try {
    await svc.bulkReviewChanges({
      selections: [
        { contractId: 'contract-order', changeId: 'chg-order-1' },
        { contractId: 'contract-payment', changeId: 'chg-pay-1' },
      ],
      reviewState: 'accepted',
      reviewer: '批量操作人',
      comment: '批量接受',
      expectedRevisions: {
        'contract-order': order.revision,
        'contract-payment': payment.revision, // 旧 revision
      },
    });
  } catch (error) {
    bulkConflict = error;
  }
  check('批量操作撞到冲突', bulkConflict instanceof svc.RevisionConflictError);

  const orderAfter = await svc.getContract('contract-order');
  check('order 没被写一半', orderAfter.revision === order.revision);
  check(
    'order 上的勾选结论未被修改',
    orderAfter.changes[0].reviewComment !== '批量接受',
  );
  check('payment 保持别人的修改', paymentChanged.revision === payment.revision + 1);
});

await section('7. 豁免登记：原子更新变更结论，发布快照带上豁免', async () => {
  freshStore();
  let payment = await svc.getContract('contract-payment');
  payment = await svc.addExemption({
    contractId: 'contract-payment',
    changeId: 'chg-pay-1',
    scope: 'settlementBatchId 兼容读取',
    reason: '财务双写期保留',
    approvedBy: '审批人X',
    expiresAt: '2026-12-31',
    expectedRevision: payment.revision,
  });
  const change = payment.changes.find((c: { id: string }) => c.id === 'chg-pay-1');
  check('登记豁免后变更状态为 exemption', change.reviewState === 'exemption');
  check('豁免入库', payment.exemptions.some((e: { changeId: string }) => e.changeId === 'chg-pay-1'));

  const released = await svc.freezeVersion({
    contractId: 'contract-payment',
    expectedRevision: payment.revision,
    version: '4.3.0',
    notes: '带豁免发布',
    idempotencyKey: 'rel-with-exemption',
  });
  check('发布快照含豁免', released.versions[0].exemptions.length === 1);
  check('豁免快照字段完整', released.versions[0].exemptions[0].scope === 'settlementBatchId 兼容读取');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
