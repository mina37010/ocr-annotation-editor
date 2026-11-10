import { LocateFixed } from "lucide-react";
import { useEffect, useRef } from "react";
import type { OcrRecord } from "../types";
import { numberValue } from "../lib/geometry";

type Props = {
  records: OcrRecord[];
  selectedId: string | null;
  mergeMode: boolean;
  mergeIds: string[];
  reorderMode: boolean;
  reorderIds: string[];
  onSelect: (id: string, focus: boolean) => void;
  onMergePick: (id: string) => void;
  onReorderPick: (id: string) => void;
};

export function AnnotationList({ records, selectedId, mergeMode, mergeIds, reorderMode, reorderIds, onSelect, onMergePick, onReorderPick }: Props) {
  const selectedRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  return (
    <div className="annotation-list">
      {records.map((record) => {
        const selected = record.annotation_id === selectedId;
        const confidence = numberValue(record.confidence);
        const sequenceIndex = mergeMode ? mergeIds.indexOf(record.annotation_id) : reorderMode ? reorderIds.indexOf(record.annotation_id) : -1;
        return (
          <button
            ref={selected ? selectedRef : undefined}
            type="button"
            className={`annotation-row${selected ? " selected" : ""}${sequenceIndex >= 0 ? mergeMode ? " merge-selected" : " reorder-selected" : ""}`}
            key={record.annotation_id}
            onClick={() => mergeMode ? onMergePick(record.annotation_id) : reorderMode ? onReorderPick(record.annotation_id) : onSelect(record.annotation_id, true)}
          >
            <span className={`status-dot status-${record.status || "machine"}`} />
            <span className="annotation-row-main">
              <strong>{record.text || "(空欄)"}</strong>
              <small>{record.annotation_id.split("/").pop()}</small>
            </span>
            <span className={`confidence${confidence < 0.5 ? " low" : ""}`}>{Math.round(confidence * 100)}%</span>
            {sequenceIndex >= 0 ? <span className={`sequence-list-order ${mergeMode ? "merge" : "reorder"}`}>{sequenceIndex + 1}</span> : <LocateFixed size={15} />}
          </button>
        );
      })}
    </div>
  );
}
