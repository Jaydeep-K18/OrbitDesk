/**
 * Rule classifier v1 (ROADMAP §7.3–7.4). Pure and deterministic.
 * Precedence: user feedback → blocked → planned → user overrides → rule matrix → UNCERTAIN.
 */
import catalogData from '../../../data/domain-categories.json' with { type: 'json' };
import matrixData from '../../../data/task-domain-matrix.json' with { type: 'json' };
import { hostMatches } from './domains.js';
import { dominantCategory } from './sessions.js';

export const RULES_CLASSIFIER_VERSION = 'rules-v1';

export type FinalLabel = 'PLANNED' | 'UNPLANNED_RELEVANT' | 'DISTRACTION' | 'BLOCKED' | 'UNCERTAIN';
export type LabelSourceValue =
  'session_list' | 'user_override' | 'rule' | 'llm' | 'ml' | 'user_feedback';

export interface Classification {
  label: FinalLabel;
  confidence: number;
  source: LabelSourceValue;
  reasonCode: string;
  explanation: string;
  classifierVersion: string;
  /** True when the rules found the domain ambiguous for this task: a context classifier (P2+) should decide. */
  needsContext: boolean;
  /** Domain category from the catalog, if known. */
  domainCategory: string | null;
}

export interface UserOverride {
  host: string;
  list: 'relevant' | 'always_distraction';
  /** '*' for all tasks, or a task category. */
  scope: string;
}

export interface ClassificationContext {
  blockedHosts: string[];
  relevantHosts: string[];
  overrides: UserOverride[];
  /** Task categories of the work block the segment falls in (all session tasks in P1). */
  taskCategories: string[];
  /** Optional catalog override for tests; defaults to the seeded catalog. */
  lookupCategory?: (host: string) => string | null;
}

export interface SegmentLike {
  host: string;
  registrableDomain: string;
  durationSec: number;
}

type Verdict = 'R' | 'D' | 'A' | 'U';

const catalog = new Map<string, string>();
for (const [category, hosts] of Object.entries(catalogData.categories)) {
  for (const host of hosts) catalog.set(host, category);
}
const matrix = matrixData.matrix as unknown as Record<string, Record<string, [Verdict, number]>>;

/** Most specific catalog match: exact host, then each parent domain (m.youtube.com → youtube.com). */
export function lookupDomainCategory(host: string): string | null {
  const labels = host.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join('.');
    const hit = catalog.get(candidate);
    if (hit) return hit;
  }
  return null;
}

export function catalogSize(): number {
  return catalog.size;
}

/** Hosts in the given categories (used to tell the extension which titles never to collect). */
export function hostsInCategories(categories: readonly string[]): string[] {
  return [...catalog.entries()].filter(([, c]) => categories.includes(c)).map(([h]) => h);
}

const CATEGORY_LABELS: Record<string, string> = {
  dev_tools: 'a developer tool',
  docs_reference: 'documentation/reference',
  q_and_a: 'a Q&A site',
  ai_assistant: 'an AI assistant',
  education: 'an education site',
  video_mixed: 'a video site',
  social: 'social media',
  entertainment: 'entertainment',
  gaming: 'gaming',
  news: 'news',
  shopping: 'shopping',
  search: 'a search engine',
  email: 'email',
  messaging: 'messaging',
  productivity: 'a productivity tool',
  finance: 'finance',
  health: 'health',
  adult: 'adult content',
};

const TASK_LABELS: Record<string, string> = {
  coding_practice: 'coding practice',
  study: 'studying',
  project_dev: 'project development',
  writing: 'writing',
  research: 'research',
  other: 'your task',
};

function result(
  label: FinalLabel,
  confidence: number,
  source: LabelSourceValue,
  reasonCode: string,
  explanation: string,
  domainCategory: string | null,
  needsContext = false,
): Classification {
  return {
    label,
    confidence,
    source,
    reasonCode,
    explanation,
    classifierVersion: RULES_CLASSIFIER_VERSION,
    needsContext,
    domainCategory,
  };
}

export function classifySegment(segment: SegmentLike, ctx: ClassificationContext): Classification {
  const lookup = ctx.lookupCategory ?? lookupDomainCategory;
  const host = segment.host;
  const category = lookup(host);

  // Blocked domain visited (page loaded before the rule applied, or blocked mid-session).
  if (ctx.blockedHosts.some((b) => hostMatches(host, b))) {
    return result(
      'DISTRACTION',
      1,
      'session_list',
      'blocked_domain_visited',
      `${host} is on this session's block list.`,
      category,
    );
  }

  if (ctx.relevantHosts.some((r) => hostMatches(host, r))) {
    return result(
      'PLANNED',
      1,
      'session_list',
      'planned_domain',
      `${host} is in this session's relevant sites.`,
      category,
    );
  }

  const taskCategory = dominantCategory(ctx.taskCategories);
  const applicable = ctx.overrides.filter(
    (o) => hostMatches(host, o.host) && (o.scope === '*' || o.scope === taskCategory),
  );
  // Task-scoped overrides beat global ones; distraction beats relevant at equal specificity.
  const scoped = applicable.filter((o) => o.scope !== '*');
  const pick = (list: UserOverride[]) =>
    list.find((o) => o.list === 'always_distraction') ?? list.find((o) => o.list === 'relevant');
  const override = pick(scoped) ?? pick(applicable);
  if (override) {
    if (override.list === 'always_distraction') {
      return result(
        'DISTRACTION',
        0.95,
        'user_override',
        'user_always_distraction',
        `You marked ${host} as a distraction${override.scope !== '*' ? ` for ${TASK_LABELS[override.scope] ?? override.scope}` : ''}.`,
        category,
      );
    }
    if (override.scope === '*') {
      return result(
        'PLANNED',
        0.95,
        'user_override',
        'user_always_relevant',
        `${host} is in your always-relevant list.`,
        category,
      );
    }
    return result(
      'UNPLANNED_RELEVANT',
      0.95,
      'user_override',
      'user_relevant_for_task',
      `You marked ${host} as relevant for ${TASK_LABELS[override.scope] ?? override.scope}.`,
      category,
    );
  }

  if (!category) {
    return result(
      'UNCERTAIN',
      0.3,
      'rule',
      'unknown_domain',
      `${host} isn't in the catalog, so there isn't enough context to judge it.`,
      null,
    );
  }

  const cell = matrix[taskCategory]?.[category] ?? (['U', 0.5] as [Verdict, number]);
  const [verdict, confidence] = cell;
  const what = CATEGORY_LABELS[category] ?? category;
  const task = TASK_LABELS[taskCategory] ?? taskCategory;
  switch (verdict) {
    case 'R':
      return result(
        'UNPLANNED_RELEVANT',
        confidence,
        'rule',
        'category_relevant',
        `${host} is ${what}, which usually supports ${task}.`,
        category,
      );
    case 'D':
      return result(
        'DISTRACTION',
        confidence,
        'rule',
        'category_distracting',
        `${host} is ${what}, which is unrelated to ${task}.`,
        category,
      );
    case 'A':
      return result(
        'UNCERTAIN',
        confidence,
        'rule',
        'needs_context',
        `${host} is ${what}; whether it helps ${task} depends on what you were viewing.`,
        category,
        true,
      );
    default:
      return result(
        'UNCERTAIN',
        confidence,
        'rule',
        'category_neutral',
        `${host} is ${what}; FocusGuard can't tell if it relates to ${task}.`,
        category,
      );
  }
}
