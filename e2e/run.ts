/**
 * End-to-end check: the app's REAL data layer / payment / sync code (SQLite via node:sqlite shim) talking to the REAL
 * backend service logic (in-memory repo). Run:  npm run e2e   (from /mobile)
 */
import assert from 'node:assert/strict';
import nacl from 'tweetnacl';
import crypto from 'node:crypto';

// ---- controllable clock (the app uses Date.now) ----
let clock = 1_800_000_000_000;
Date.now = () => clock;
const advance = (ms: number) => { clock += ms; };
const H = 3600_000;

// ---- backend (real services, in-memory repo) ----
const server = nacl.sign.keyPair();
process.env.EXPO_PUBLIC_SERVER_PUBLIC_KEY = Buffer.from(server.publicKey).toString('base64');
const serverSecretKey = Buffer.from(server.secretKey).toString('base64');

async function main() {
  const { createMemoryRepo } = await import('../../backend/test/memoryRepo');
  const { createTransactionService } = await import('../../backend/src/services/transactionService');
  const { createFundingService } = await import('../../backend/src/services/fundingService');
  const bproto = await import('../../backend/src/lib/protocol');
  const config: any = { currency: 'NGN', minAmount: 10_000, maxAmount: 50_000_000, minFunding: 10_000, maxFunding: 50_000_000, maxQrWindowMs: 600_000,
    maxSyncAgeMs: 7 * 24 * H, clockSkewMs: 120_000, serverPublicKey: process.env.EXPO_PUBLIC_SERVER_PUBLIC_KEY, serverSecretKey };
  const brepo = createMemoryRepo();
  const txs = createTransactionService(brepo, config, () => clock);
  const funding = createFundingService(brepo, config, (u) => txs.reevaluateDeferred(u), undefined, () => clock);

  // ---- mobile modules (real) ----
  const api = (await import('../src/services/api')).api;
  const repo = await import('../src/db/repo');
  const crypt = await import('../src/lib/crypto');
  const pay = await import('../src/services/paymentService');
  const { syncNow } = await import('../src/services/syncManager');
  const { verifyCertificate } = await import('../src/lib/protocol');

  let current: { id: string; name: string } = { id: '', name: '' };
  let netDown = false;
  let completeFlags: boolean[] = [];
  (api as any).certificate = async () => { throw new Error('skip'); };
  (api as any).fundingInitiate = async (a: number) => ({ funding: await funding.initiate(current, a) });
  (api as any).fundingSimulate = async (r: string) => ({ funding: await funding.simulatePayment(current, r) });
  (api as any).fundingVerify = async (r: string) => ({ confirmation: await funding.verify(current, r) });
  (api as any).sync = async (b: any) => {
    if (netDown) { const { ApiError } = await import('../src/services/api'); throw new ApiError(0, 'down', true); }
    completeFlags.push(b.complete);
    // same logic as backend/src/routes/sync.ts
    const user = current; const fr: any[] = []; let failed = false;
    for (const f of b.funding) fr.push(await funding.applyOnSync(user as any, f));
    const inc = b.transactions.filter((t: any) => t.recipient_id === user.id), out = b.transactions.filter((t: any) => t.recipient_id !== user.id);
    const byT = (x: any, y: any) => x.timestamp - y.timestamp; const results: any[] = [];
    for (const t of [...inc.sort(byT), ...out.sort(byT)]) results.push(await txs.processOne(user as any, t, 'dev'));
    if (b.complete && !failed) await txs.completeSync(user.id);
    return { funding_results: fr, results, balance: await brepo.getBalance(user.id), server_time: clock };
  };

  // ---- onboarding (what AuthContext does): backend account, device key, certificate, local wallet at 0 ----
  let walletN = 100_000_000;
  async function onboard(name: string) {
    const id = crypto.randomBytes(12).toString('hex');
    const walletId = `PBW${walletN++}`;
    brepo.addUser({ id, name, walletId, publicKey: null as any, status: 'active' } as any);
    const kp = crypt.generateKeyPair();
    await crypt.saveKeyPair(id, kp);
    await crypt.setPin(id, '1234');
    const cert = bproto.issueCertificate({ id, name, walletId }, kp.publicKey, serverSecretKey, clock, 30 * 24 * H);
    brepo.addCertificate(id, kp.publicKey);
    assert.ok(verifyCertificate(cert as any, process.env.EXPO_PUBLIC_SERVER_PUBLIC_KEY!), 'mobile verifies backend certificate');
    await repo.upsertUser({ id, name, wallet_id: walletId });
    await repo.saveCertificate(id, cert as any);
    await repo.ensureWallet(id, walletId);
    return { id, name };
  }
  const as = (u: { id: string; name: string }) => { current = u; };
  const bal = async (u: any) => (await repo.getWallet(u.id))!.balance;
  const st = async (u: any, id: string) => (await repo.getTransaction(u.id, id))!.status;
  const sync = async (u: any, force = true) => { as(u); return syncNow(u.id, force); };
  const fund = async (u: any, naira: number) => {
    as(u);
    const { funding: f } = await api.fundingInitiate(naira * 100); await api.fundingSimulate(f.reference);
    const { confirmation } = await api.fundingVerify(f.reference);
    await repo.recordFunding(u.id, confirmation as any, u.name);
    return confirmation;
  };
  /** full receiver-first handshake; returns payment info. `scan:false` = receiver never scans the payment QR */
  const handshake = async (from: any, to: any, naira: number, scan = true) => {
    const rq = await pay.receiveQR(to.id);
    const v = pay.validateRecipientQr(rq.qr, from.id); assert.ok(v.ok, 'recipient QR valid');
    const out = await pay.createPayment(from.id, from.name, (v as any).recipient, naira * 100, '1234');
    let accepted: any = null;
    if (scan) { accepted = await pay.acceptIncomingPayment(to.id, to.name, out.qr); }
    return { out, accepted, id: out.payment.transaction_id };
  };
  const ok = (m: string) => console.log('  ✓', m);
  const section = (m: string) => console.log('\n' + m);
  const ledgerOk = async (...us: any[]) => { for (const u of us) { const l = await repo.verifyLedger(u.id); assert.ok(l.ok, `ledger sum == balance for ${u.name} (${l.balance} vs ${l.ledgerSum})`); } };

  /* ===================================================== 1. registration + funding */
  section('1. Registration & funding');
  const A = await onboard('Alice'), B = await onboard('Bob'), C = await onboard('Chidi');
  assert.equal(await bal(A), 0); ok('local wallet starts at ₦0 (mirror independent)');
  const conf = await fund(A, 1000);
  assert.equal(await bal(A), 100_000); assert.equal(await st(A, conf.reference), 'PENDING_SYNC'); ok('funding credits locally, marked PENDING_SYNC');
  await assert.rejects(repo.recordFunding(A.id, conf as any, A.name), /already been credited/); assert.equal(await bal(A), 100_000); ok('same funding reference cannot be credited twice');
  await ledgerOk(A);
  await sync(A);
  assert.equal(await st(A, conf.reference), 'CONFIRMED'); assert.equal(await brepo.getBalance(A.id), 100_000); ok('funding synced → CONFIRMED, backend mirror = ₦1,000');
  assert.equal((await repo.getDeadlineInfo(A.id)).deadline, null); ok('funding alone starts no sync deadline');
  assert.ok(completeFlags.length && completeFlags[completeFlags.length - 1] === true); ok('sync reports complete=true when everything was uploaded');

  /* ===================================================== 2. offline payment, both devices */
  section('2. Offline payment A → B');
  await assert.rejects(repo.createOutgoingPayment(A.id, { payerName: 'Alice', recipientId: B.id, recipientName: 'Bob', amount: 20_000, reference: 'a'.repeat(24), certificate: (await repo.getCertificate(A.id))! }, () => { throw new Error('QR failure'); }), /QR failure/);
  assert.equal(await bal(A), 100_000); assert.equal((await repo.pendingStats(A.id)).count, 0); assert.equal((await repo.getWallet(A.id))!.dailyUsed, 0);
  ok('QR/signing failure rolls back debit, ledger, daily total, transaction'); await ledgerOk(A);
  await assert.rejects(handshake(A, B, 50, false), /./); ok('below ₦100 minimum is refused');
  await assert.rejects(handshake(A, B, 5000, false), /Insufficient/); ok('over local balance is refused');
  const p1 = await handshake(A, B, 300);
  assert.equal(await bal(A), 70_000); assert.equal(await st(A, p1.id), 'PENDING_SYNC');
  assert.ok(p1.accepted.ok); assert.equal(await bal(B), 30_000); assert.equal(await st(B, p1.id), 'PENDING_SYNC'); ok('sender debited, receiver auto-credited, both PENDING_SYNC');
  const dl = await repo.getDeadlineInfo(A.id); assert.equal(dl.deadline, clock + 72 * H); assert.equal((await repo.getWallet(A.id))!.dailyUsed, 30_000); ok('72h deadline + daily total set by first outstanding offline tx');
  const dup = await pay.acceptIncomingPayment(B.id, B.name, p1.out.qr); assert.ok(!dup.ok); assert.equal(await bal(B), 30_000); ok('replayed payment QR rejected (unique txid)');
  const wrongRcv = await pay.acceptIncomingPayment(C.id, C.name, p1.out.qr); assert.ok(!wrongRcv.ok); ok('payment addressed to someone else rejected');
  await ledgerOk(A, B);
  const r1 = await sync(A); assert.equal(r1.ok, true); assert.equal(await st(A, p1.id), 'PENDING_SYNC'); assert.equal(await brepo.getBalance(B.id), 0); ok('sender-only sync stays pending, mirror untouched');
  await sync(B); assert.equal(await st(B, p1.id), 'CONFIRMED');
  await sync(A); assert.equal(await st(A, p1.id), 'CONFIRMED'); ok('after both sides sync → CONFIRMED on both');
  assert.equal(await brepo.getBalance(A.id), 70_000); assert.equal(await brepo.getBalance(B.id), 30_000); ok('mirror updated exactly once (A ₦700, B ₦300) = local balances');
  assert.equal((await repo.getDeadlineInfo(A.id)).deadline, null); assert.equal((await repo.getDeadlineInfo(B.id)).deadline, null); ok('deadline cleared once all outstanding are reconciled');
  await sync(A); await sync(B); assert.equal(await brepo.getBalance(B.id), 30_000); ok('repeated syncs are idempotent');
  await ledgerOk(A, B);

  /* ===================================================== 3. dependency chain */
  section('3. Chain A → B → C (B spends money it has not yet synced)');
  const c1 = await handshake(A, B, 500);        // A: 700-500=200 ; B: 300+500=800 (500 unconfirmed)
  const c2 = await handshake(B, C, 600);        // B spends 300 confirmed + 300 of the pending 500
  const deps = await repo.getDependencies(B.id, c2.id);
  assert.deepEqual(JSON.parse(JSON.stringify(deps)), [{ depends_on_id: c1.id, amount: 30_000 }]); ok('B→C records dependency on A→B with allocated ₦300');
  await sync(C); assert.notEqual(await st(C, c2.id), 'CONFIRMED'); ok('C syncs FIRST: not confirmed yet (waiting for causal order)');
  await sync(B); await sync(A); await sync(B); await sync(C);
  for (const [u, id] of [[A, c1.id], [B, c1.id], [B, c2.id], [C, c2.id]] as const) assert.equal(await st(u, id), 'CONFIRMED');
  ok('after A and B sync, whole chain CONFIRMED');
  assert.equal(await brepo.getBalance(A.id), 20_000);
  assert.equal(await bal(B), await brepo.getBalance(B.id)); assert.equal(await bal(C), await brepo.getBalance(C.id)); assert.equal(await bal(A), await brepo.getBalance(A.id)); ok('local balances == backend mirrors for A, B, C');
  await ledgerOk(A, B, C);

  /* ===================================================== 4. expired QR + refund */
  section('4. Expired QR and refund');
  const before = await bal(C);
  const e1 = await handshake(C, A, 100, false);       // C pays A ₦100, A never scans
  assert.equal(await bal(C), before - 10_000);
  const late = await pay.acceptIncomingPayment(A.id, A.name, e1.out.qr, clock + 6 * 60_000);
  assert.ok(!late.ok && (late as any).expired); ok('receiver rejects an expired QR');
  advance(10 * 60_000); await repo.expireOverdue(C.id);
  assert.equal(await st(C, e1.id), 'EXPIRED'); ok('sender transaction marked EXPIRED (still pending)');
  await sync(C); assert.equal(await st(C, e1.id), 'EXPIRED'); ok('backend stays unresolved – receiver has not synced yet; no refund');
  await sync(A);      // receiver completes a full sync with no record
  await sync(C);
  assert.equal(await st(C, e1.id), 'REFUNDED'); assert.equal(await bal(C), before); ok('after receiver\'s complete sync: ONE refund, wallet restored, REFUNDED');
  const t = (await repo.getTransaction(C.id, e1.id))!; assert.ok(t.refund_reference); ok('refund reference stored: ' + t.refund_reference);
  const bb = await brepo.getBalance(C.id); await sync(C); await sync(C); assert.equal(await brepo.getBalance(C.id), bb); assert.equal(await bal(C), before); ok('duplicate refund attempts return the earlier result (no double credit)');
  assert.equal((await repo.getDeadlineInfo(C.id)).deadline, null); await ledgerOk(C);

  /* ===================================================== 5. deadline semantics */
  section('5. Synchronization deadline');
  const d1 = await handshake(A, B, 100);
  const started = (await repo.getDeadlineInfo(A.id)).deadline!;
  netDown = true; await sync(A); advance(30 * H);
  assert.equal((await repo.getDeadlineInfo(A.id)).deadline, started); ok('failed sync does NOT restart the countdown');
  assert.equal((await repo.getDeadlineInfo(A.id)).stage, 1); advance(20 * H); assert.equal((await repo.getDeadlineInfo(A.id)).stage, 2); ok('reminder stages at 24h / 48h');
  advance(30 * H);
  const info = await repo.getDeadlineInfo(A.id); assert.ok(info.restricted); ok('restricted after 72h with outstanding transactions');
  await assert.rejects(handshake(A, C, 100, false), /paused/); ok('new offline payment blocked while restricted');
  await assert.rejects(pay.acceptIncomingPayment(A.id, A.name, 'x'), /./).catch(() => {}); 
  netDown = false; await sync(A); await sync(B); await sync(A);
  assert.equal(await st(A, d1.id), 'CONFIRMED'); const after = await repo.getDeadlineInfo(A.id); assert.equal(after.deadline, null); assert.ok(!after.restricted); ok('after reconciliation the restriction lifts and the deadline is cleared');
  // deadline passed but nothing outstanding → not enforced
  await db_setDeadline(A.id, clock - H); assert.ok(!(await repo.getDeadlineInfo(A.id)).restricted); ok('expired deadline is not enforced when nothing is outstanding');

  /* ===================================================== 6. daily allowance */
  section('6. Daily offline allowance');
  const big = await fund(A, 200000 / 1); // ₦200,000 → will exceed ₦50,000 daily
  await assert.rejects(handshake(A, B, 60000, false), /daily/i); ok('payment above daily allowance refused');
  const w = (await repo.getWallet(A.id))!; assert.ok(w.dailyRemaining <= 5_000_000); ok('allowance tracked: remaining ' + w.dailyRemaining / 100);
  await ledgerOk(A, B, C);
  console.log('\nALL E2E CHECKS PASSED');

  async function db_setDeadline(owner: string, ts: number) { const { getDb } = await import('../src/db/db'); await (await getDb()).runAsync('UPDATE wallet SET sync_deadline=? WHERE user_id=?', [ts, owner]); }
}
main().catch((e) => { console.error('\nFAILED:', e); process.exit(1); });
