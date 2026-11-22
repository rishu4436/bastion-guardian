export const metadata = { title: "Offline" };

export default function Offline() {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <h1 className="text-2xl font-semibold">You are offline</h1>
      <p className="mt-3 text-sm text-muted">
        BASTION never shows cached health factors or balances as current, so nothing is displayed until the
        connection returns. On-chain protection keeps running independently of this app.
      </p>
    </div>
  );
}
