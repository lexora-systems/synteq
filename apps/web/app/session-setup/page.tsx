"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { WorkspaceSetupLoadingCard } from "../../components/workspace-setup-loading";

export default function SessionSetupPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/welcome");
  }, [router]);

  return <WorkspaceSetupLoadingCard />;
}
