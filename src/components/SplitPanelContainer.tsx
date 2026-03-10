"use client";

import { Fragment } from "react";
import { useStore } from "@/store";
import { SplitPanelItem } from "./SplitPanelItem";
import { SplitResizeHandle } from "./SplitResizeHandle";
import type { ClientMessage } from "@/lib/shared/protocol";
import type { FileReadResult } from "@/hooks/useWebSocket";

interface SplitPanelContainerProps {
  send: (msg: ClientMessage) => void;
  requestFileRead: (machineId: string, filePath: string, maxLines?: number) => Promise<FileReadResult>;
}

export function SplitPanelContainer({ send, requestFileRead }: SplitPanelContainerProps) {
  const splitPanels = useStore((s) => s.splitPanels);
  const focusedPanelId = useStore((s) => s.focusedPanelId);

  return (
    <div className="flex flex-1 min-w-0 h-full overflow-hidden">
      {splitPanels.map((panel, index) => (
        <Fragment key={panel.id}>
          {index > 0 && (
            <SplitResizeHandle leftPanelId={splitPanels[index - 1].id} />
          )}
          <SplitPanelItem
            panel={panel}
            isFocused={panel.id === focusedPanelId}
            isLast={index === splitPanels.length - 1}
            canClose={splitPanels.length > 1}
            send={send}
            requestFileRead={requestFileRead}
          />
        </Fragment>
      ))}
    </div>
  );
}
