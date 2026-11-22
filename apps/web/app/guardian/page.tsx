import { Suspense } from "react";
import { GuardianMode } from "./guardian";
import { Loading } from "@/components/ui";

export const metadata = { title: "Guardian Mode" };

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <GuardianMode />
    </Suspense>
  );
}
