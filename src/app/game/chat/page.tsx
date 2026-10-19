import { Suspense } from "react";
import ChatPage from "@/modules/social/ui/ChatPage";

export default function GameChatPage() {
  return (
    <Suspense fallback={null}>
      <ChatPage />
    </Suspense>
  );
}
