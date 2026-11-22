import { Suspense } from "react";
import { PolicyWizard } from "./wizard";
import { Loading } from "@/components/ui";

export const metadata = { title: "New protection policy" };

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <PolicyWizard />
    </Suspense>
  );
}
