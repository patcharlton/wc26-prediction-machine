import type { Outcome, ProbTriple, Stage } from "./types";

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function argmax(p: ProbTriple): Outcome {
  if (p.homeWin >= p.draw && p.homeWin >= p.awayWin) return "homeWin";
  if (p.awayWin >= p.draw && p.awayWin >= p.homeWin) return "awayWin";
  return "draw";
}

export function kickoffLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const STAGE_LABEL: Record<string, string> = {
  R32: "Round of 32",
  R16: "Round of 16",
  QF: "Quarter-finals",
  SF: "Semi-finals",
  Final: "Final",
};

export function groupLetter(stage: Stage): string | null {
  return stage.startsWith("group") ? stage.slice(5) : null;
}

export const KO_ORDER: Stage[] = ["R32", "R16", "QF", "SF", "Final"];
