import React, { useState } from "react";
import { HomeView } from "./HomeView";
import { TraceView } from "./TraceView";

export function App(): React.ReactElement {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  if (selectedSessionId !== null) {
    return (
      <TraceView
        sessionId={selectedSessionId}
        onBack={() => setSelectedSessionId(null)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="mx-auto max-w-5xl flex items-center gap-3">
          <span className="text-xl font-semibold tracking-tight text-white">
            tracelight
          </span>
          <span className="text-xs text-gray-500 mt-0.5">
            Claude Code session viewer
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        <HomeView onSelectSession={setSelectedSessionId} />
      </main>
    </div>
  );
}
