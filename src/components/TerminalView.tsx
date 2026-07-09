import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";
import { api } from "../api";
import { useTheme } from "../context/ThemeContext";

interface TerminalViewProps {
  sessionId: string;
  active: boolean;
  panelVisible: boolean;
  onSessionClosed: (sessionId: string) => void;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

export function TerminalView({
  sessionId,
  active,
  panelVisible,
  onSessionClosed,
}: TerminalViewProps) {
  const { colors } = useTheme();
  const colorsRef = useRef(colors);
  colorsRef.current = colors;

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const onClosedRef = useRef(onSessionClosed);
  onClosedRef.current = onSessionClosed;

  // Init xterm once per sessionId — never depend on callback identity
  useEffect(() => {
    if (!containerRef.current) return;

    const c = colorsRef.current;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "Consolas, 'Courier New', monospace",
      scrollback: 10000,
      theme: {
        background: c.terminalBg,
        foreground: c.terminalFg,
        cursor: c.terminalCursor,
        selectionBackground: c.border,
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    try {
      term.loadAddon(new WebglAddon());
    } catch {
      // WebGL unavailable — canvas renderer is fine
    }

    term.open(containerRef.current);
    fitAddon.fit();
    termRef.current = term;
    fitRef.current = fitAddon;

    const sid = sessionId;

    const resizeObserver = new ResizeObserver(() => {
      if (!termRef.current) return;
      fitAddon.fit();
      const { cols, rows } = term;
      void api.resizeTerminal(sid, cols, rows);
    });
    resizeObserver.observe(containerRef.current);

    const onData = term.onData((data) => {
      void api.sendTerminalInput(sid, bytesToBase64(new TextEncoder().encode(data)));
    });

    const unlistenOutput = listen<{ sessionId: string; data: string }>(
      "terminal-output",
      (event) => {
        if (event.payload.sessionId !== sid) return;
        const binary = atob(event.payload.data);
        const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
        term.write(bytes);
      },
    );

    const unlistenClosed = listen<{ sessionId: string; exitCode?: number }>(
      "terminal-closed",
      (event) => {
        if (event.payload.sessionId !== sid) return;
        term.writeln(
          `\r\n\x1b[33m[session closed${event.payload.exitCode != null ? `, exit ${event.payload.exitCode}` : ""}]\x1b[0m`,
        );
        onClosedRef.current(sid);
      },
    );

    return () => {
      onData.dispose();
      resizeObserver.disconnect();
      void unlistenOutput.then((fn) => fn());
      void unlistenClosed.then((fn) => fn());
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = {
      background: colors.terminalBg,
      foreground: colors.terminalFg,
      cursor: colors.terminalCursor,
      selectionBackground: colors.border,
    };
  }, [colors]);

  useEffect(() => {
    if (panelVisible && active && fitRef.current && termRef.current) {
      // Parent may have been display:none — refit when tab becomes visible
      requestAnimationFrame(() => {
        fitRef.current?.fit();
        if (termRef.current) {
          const { cols, rows } = termRef.current;
          void api.resizeTerminal(sessionId, cols, rows);
          termRef.current.refresh(0, termRef.current.rows - 1);
        }
      });
    }
  }, [panelVisible, active, sessionId]);

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 overflow-hidden ${active ? "z-10" : "hidden"}`}
    />
  );
}
