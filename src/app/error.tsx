"use client";

import { useEffect } from "react";
import GameRouteErrorCard from "@/modules/shared/ui/components/GameRouteErrorCard";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <GameRouteErrorCard
      title="页面暂时无法展开"
      description={error.message || "当前页面处理失败，你可以重试，或先返回地图继续行动。"}
      onRetry={reset}
    />
  );
}
