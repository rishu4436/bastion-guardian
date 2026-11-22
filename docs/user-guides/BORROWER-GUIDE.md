# Borrower guide

BASTION watches your lending position and, when its health factor crosses the trigger you signed, repays debt within
limits you set — through a self-funded flash rescue (FlashNet) or a solver who repays now and is reimbursed from a reserve
you funded. BASTION never takes custody: every action is bounded by your on-chain policy and you can stop it at any time.

> Testnet software, not audited. Mainnet is disabled. Readiness is not a guarantee of rescue success.

## 1. Connect and sign in

Open the web app, **Connect wallet**, then **Sign in with Ethereum**. Signing in proves you own the address; it
authorizes no transaction.

## 2. Find your risk

**Liquidation Radar** ranks indexed positions by health factor. Open a position to see its on-chain health-factor
history and whether it is protected.

## 3. Create a policy (Policies → New policy)

The 17-step wizard collects: the protected account, market and assets, trigger and target health factors, per-action and
total repay caps, fee and slippage caps, allowed rescue paths, settlement chain, expiry, and approvals. You sign the
policy as EIP-712 typed data and register it in `BastionPolicyRegistry` with your wallet. The policy nonce is read live
from the registry.

## 4. Fund a reserve (optional, enables solver rescues)

**Reserve** walks through approve → deposit → allocate to a policy on the reserve chain. Only you can allocate, pause or
release your budget.

## 5. Stay informed

- **Guardian Mode** shows current readiness (ARMED / LIMITED / UNAVAILABLE) with each failing check, and a timeline.
- **Settings → Notifications**: link Telegram, email, SMS (each verified with a code) and Web Push.
- **Install** the PWA; on iPhone, add to Home Screen first to enable push (iOS 16.4+).
- The **mobile app** (apps/mobile) shows readiness, alerts and receipts read-only.

## 6. After a rescue

The **rescue receipt** shows exact indexed amounts, health factor before and after, fees and settlement state. **Proof of
Protection** gives a reproducible content-hashed JSON and a PDF.

## 7. Stop or limit protection

The **Emergency Action Center** lists every action with who can perform it: pause or resume automatic rescues, revoke the
policy, cap collateral pulls at zero, revoke token approval, pause or release reserve budgets.
