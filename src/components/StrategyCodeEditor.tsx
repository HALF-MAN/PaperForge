"use client";

import dynamic from "next/dynamic";

const MonacoEditor = dynamic(() => import("@monaco-editor/react").then((mod) => mod.default), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-[#101114] text-sm text-slate-400">
      Loading editor...
    </div>
  ),
});

type StrategyCodeEditorProps = {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
};

export function StrategyCodeEditor({
  value,
  onChange,
  readOnly = false,
}: StrategyCodeEditorProps) {
  return (
    <div className="h-[520px] overflow-hidden rounded-lg border border-[var(--line)] bg-[#101114]">
      <MonacoEditor
        height="100%"
        language="python"
        loading={
          <div className="flex h-full items-center justify-center bg-[#101114] text-sm text-slate-400">
            Loading editor...
          </div>
        }
        theme="vs-dark"
        value={value}
        onChange={(nextValue) => onChange(nextValue ?? "")}
        options={{
          automaticLayout: true,
          bracketPairColorization: { enabled: true },
          cursorBlinking: "smooth",
          fontFamily:
            "SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace",
          fontSize: 13,
          lineHeight: 22,
          minimap: { enabled: false },
          padding: { top: 16, bottom: 16 },
          readOnly,
          renderLineHighlight: "all",
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          tabSize: 4,
          wordWrap: "off",
        }}
      />
    </div>
  );
}
